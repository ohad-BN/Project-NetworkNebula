import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Cpu,
  DollarSign,
  Sliders,
  Copy,
  Check,
  RotateCw,
  Plus,
  Play,
  Pause,
  Trash2,
  Laptop,
  Monitor,
  Moon,
  Zap,
  Gamepad2,
  Thermometer,
  VolumeX,
  Clock,
} from "lucide-react";
import {
  workersService,
  type ClusterNodeTelemetry,
} from "@/services/api/workers";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";

export function WorkerDashboardPage() {
  const { apiKey: storeApiKey } = useAuthStore();
  const apiKey = storeApiKey || localStorage.getItem("api_key") || "YOUR_API_KEY";

  const [myNodes, setMyNodes] = useState<ClusterNodeTelemetry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(new Date());
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  const loadWorkerData = useCallback(async () => {
    try {
      const userFleet = await workersService.getUserWorkers();
      const userNodes = userFleet.nodes || [];
      setMyNodes(userNodes);
      setLastHeartbeat(new Date());
    } catch (err) {
      console.error("Failed to load worker telemetry:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkerData();
    const interval = setInterval(() => loadWorkerData(), 12000);
    return () => clearInterval(interval);
  }, [loadWorkerData]);

  // Handle remote slider adjustment for a specific GPU on a specific machine
  const handleSliderChange = async (targetWorkerId: string, newPct: number, gpuIndex?: number) => {
    // Optimistic update
    setMyNodes((prev) =>
      prev.map((n) => {
        if (n.node_id === targetWorkerId || n.id === targetWorkerId) {
          const updatedGpus = (n.gpus || []).map((g, idx) => {
            if (gpuIndex === undefined || g.index === gpuIndex || idx === gpuIndex) {
              return {
                ...g,
                vram_allocation_pct: newPct,
                vram_allocated_gb: Number(((g.vram_total_gb * newPct) / 100).toFixed(2)),
              };
            }
            return g;
          });
          const totalAlloc = updatedGpus.length > 0
            ? updatedGpus.reduce((acc, g) => acc + g.vram_allocated_gb, 0)
            : Number(((n.vram_total_gb * newPct) / 100).toFixed(2));

          return {
            ...n,
            vram_allocation_pct: newPct,
            vram_allocated_gb: Number(totalAlloc.toFixed(2)),
            gpus: updatedGpus.length > 0 ? updatedGpus : n.gpus,
          };
        }
        return n;
      })
    );

    try {
      setIsUpdating(true);
      await workersService.updateConfig(targetWorkerId, {
        vram_allocation_pct: newPct,
        gpu_index: gpuIndex,
      });
      toast.success(
        `Adjusted ${targetWorkerId}${gpuIndex !== undefined ? ` (GPU ${gpuIndex})` : ""} to ${newPct}% VRAM`
      );
    } catch (err) {
      console.error("Failed to update contribution slider:", err);
      toast.error("Failed to update GPU contribution percentage");
      loadWorkerData();
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle remote Pause / Resume toggle
  const handleToggleAvailability = async (targetWorkerId: string, currentAvailable: boolean) => {
    try {
      setIsUpdating(true);
      await workersService.updateConfig(targetWorkerId, {
        is_available: !currentAvailable,
      });
      toast.success(currentAvailable ? "Machine paused (offline for compute)" : "Machine resumed & accepting compute jobs");
      await loadWorkerData();
    } catch {
      toast.error("Failed to update machine status");
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle remote Always Silent toggle
  const handleToggleAlwaysSilent = async (targetWorkerId: string, currentSilent: boolean) => {
    // Optimistic UI update
    setMyNodes((prev) =>
      prev.map((n) => {
        if (n.node_id === targetWorkerId || n.id === targetWorkerId) {
          return {
            ...n,
            is_always_silent: !currentSilent,
            work_capacity_state: !currentSilent ? "stealth_regulated" : "unleashed",
            duty_cycle_pct: !currentSilent ? 33 : 100,
          };
        }
        return n;
      })
    );

    try {
      setIsUpdating(true);
      await workersService.updateConfig(targetWorkerId, {
        always_silent: !currentSilent,
      });
      toast.success(
        !currentSilent
          ? "Always Silent activated (Whisper acoustic governor & gaming auto-yield)"
          : "Always Silent disabled (Unleashed burst performance)"
      );
      await loadWorkerData();
    } catch (err) {
      console.error("Failed to toggle Always Silent mode:", err);
      toast.error("Failed to update Always Silent configuration");
      loadWorkerData();
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle Deregister
  const handleDeregister = async (targetWorkerId: string) => {
    if (!confirm(`Are you sure you want to remove machine '${targetWorkerId}' from your account?`)) return;
    try {
      await workersService.deregister(targetWorkerId);
      toast.success("Machine removed from fleet");
      await loadWorkerData();
    } catch {
      toast.error("Failed to remove machine");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    toast.success("Command copied to clipboard!");
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  // Aggregated fleet metrics
  const totalUserVram = myNodes.reduce((acc, n) => acc + (n.vram_total_gb || n.gpu_memory_gb || 0), 0);
  const allocatedUserVram = myNodes.reduce((acc, n) => acc + (n.vram_allocated_gb || 0), 0);
  const totalUserEarnings = myNodes.reduce((acc, n) => acc + (n.total_earnings_usd || 0), 0);
  const activeNodesCount = myNodes.filter((n) => (n.status === "online" || n.status === "busy") && (n.is_available ?? true)).length;
  const combinedHourlyRate = myNodes.reduce((acc, n) => acc + (n.hourly_rate_usd || 0.45), 0);
  const totalGpusCount = myNodes.reduce((acc, n) => acc + (n.gpus?.length || 1), 0);

  // Connection commands
  const originUrl = window.location.port === "5173"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : window.location.origin;

  const powershellBootstrapper = `powershell -c "irm ${originUrl}/connect.ps1?key=${apiKey} | iex"`;
  const powershellLocalCmd = `python nebula_worker.py work --server ${originUrl} --api-key ${apiKey} --tunnel --auto-claim`;
  const bashBootstrapper = `curl -sSL "${originUrl}/connect.sh?key=${apiKey}" | bash`;
  const bashLocalCmd = `./scripts/run_worker.sh --api-key ${apiKey}`;

  return (
    <div className="min-h-screen bg-background text-foreground pb-12">
      <main className="container max-w-7xl mx-auto px-4 py-8 space-y-8">
        
        {/* Top Header & Connect Action */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Host Provider Console
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight mt-1">
              GPU Fleet & Host Provider Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Contribute GPU compute from your physical workstations, Apple Silicon Macs, or multi-GPU rigs to earn compute credits & USDC.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadWorkerData()}
              className="gap-1.5 h-9 text-xs"
              disabled={isLoading}
            >
              <RotateCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            {/* Modal: Connect GPU Machine */}
            <Dialog open={isConnectModalOpen} onOpenChange={setIsConnectModalOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="gap-2 h-9 text-xs font-semibold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-md shadow-emerald-500/20"
                >
                  <Plus className="h-4 w-4" />
                  Connect Machine / Add GPU
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[94vw] max-w-xl sm:max-w-2xl bg-[#181920] border-[#2e303a] p-5 sm:p-6 shadow-2xl text-card-foreground">
                <DialogHeader className="space-y-1.5 text-left">
                  <DialogTitle className="flex items-center gap-2.5 text-lg sm:text-xl font-bold">
                    <Cpu className="h-5 w-5 text-emerald-400" />
                    Connect GPU Hardware to Your Fleet
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                    Launch the lightweight agent on any Windows PC, Apple Silicon Mac, or Linux server.
                    It links automatically to your account and appears in your dashboard in real time.
                  </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="windows" className="pt-2 w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-4 bg-muted/60">
                    <TabsTrigger value="windows" className="gap-2 text-xs py-2">
                      <Monitor className="h-4 w-4" /> Windows (PowerShell)
                    </TabsTrigger>
                    <TabsTrigger value="macos" className="gap-2 text-xs py-2">
                      <Laptop className="h-4 w-4" /> macOS / Linux (Terminal)
                    </TabsTrigger>
                  </TabsList>

                  {/* Windows Tab */}
                  <TabsContent value="windows" className="space-y-4 text-xs">
                    <div className="p-3 bg-muted/40 rounded-lg border space-y-1">
                      <p className="font-semibold text-foreground flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[11px] font-bold">1</span>
                        Open PowerShell on your Windows PC
                      </p>
                      <p className="text-muted-foreground text-[11px] pl-7">
                        Requires Python 3.10+ and NVIDIA CUDA drivers.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-bold">2</span>
                          Run the 1-Click PowerShell Connector
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Pre-authenticated</span>
                      </div>

                      {/* Non-bursting wrapping code container */}
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pb-1 border-b border-slate-800/80">
                          <span className="font-mono text-emerald-400">PowerShell 1-Click</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs gap-1.5 font-sans text-slate-300 hover:text-white"
                            onClick={() => copyToClipboard(powershellBootstrapper, "ps-boot")}
                          >
                            {copiedCmd === "ps-boot" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            <span>{copiedCmd === "ps-boot" ? "Copied!" : "Copy Command"}</span>
                          </Button>
                        </div>
                        <pre className="font-mono text-xs text-emerald-400 whitespace-pre-wrap break-all select-all leading-relaxed m-0 p-0">
                          {powershellBootstrapper}
                        </pre>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-1.5">
                      <span className="text-muted-foreground text-[11px] block">Or if already inside this project repository directory:</span>
                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
                        <code className="font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-all flex-1 select-all">
                          {powershellLocalCmd}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-slate-300 hover:text-white shrink-0"
                          onClick={() => copyToClipboard(powershellLocalCmd, "ps-local")}
                        >
                          {copiedCmd === "ps-local" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  {/* macOS / Linux Tab */}
                  <TabsContent value="macos" className="space-y-4 text-xs">
                    <div className="p-3 bg-muted/40 rounded-lg border space-y-1">
                      <p className="font-semibold text-foreground flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[11px] font-bold">1</span>
                        Open Terminal on your Mac or Linux Server
                      </p>
                      <p className="text-muted-foreground text-[11px] pl-7">
                        Supports Apple Silicon M1/M2/M3/M4 via Metal Performance Shaders (MPS) or Linux NVIDIA CUDA.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-bold">2</span>
                          Run the 1-Click Terminal Connector
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Pre-authenticated</span>
                      </div>

                      {/* Non-bursting wrapping code container */}
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pb-1 border-b border-slate-800/80">
                          <span className="font-mono text-emerald-400">Bash 1-Click</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs gap-1.5 font-sans text-slate-300 hover:text-white"
                            onClick={() => copyToClipboard(bashBootstrapper, "sh-boot")}
                          >
                            {copiedCmd === "sh-boot" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            <span>{copiedCmd === "sh-boot" ? "Copied!" : "Copy Command"}</span>
                          </Button>
                        </div>
                        <pre className="font-mono text-xs text-emerald-400 whitespace-pre-wrap break-all select-all leading-relaxed m-0 p-0">
                          {bashBootstrapper}
                        </pre>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-1.5">
                      <span className="text-muted-foreground text-[11px] block">Or if already inside this project repository directory:</span>
                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
                        <code className="font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-all flex-1 select-all">
                          {bashLocalCmd}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-slate-300 hover:text-white shrink-0"
                          onClick={() => copyToClipboard(bashLocalCmd, "sh-local")}
                        >
                          {copiedCmd === "sh-local" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Fleet Metrics Strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="p-4 sm:p-5 pb-2">
              <CardDescription className="text-xs">Connected Systems</CardDescription>
              <CardTitle className="text-2xl font-bold flex items-center justify-between">
                <span>{myNodes.length}</span>
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 font-mono text-[10px]">
                  {activeNodesCount} Online
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground">
              Host machines
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 sm:p-5 pb-2">
              <CardDescription className="text-xs">Physical GPUs</CardDescription>
              <CardTitle className="text-2xl font-bold font-mono text-primary flex items-center justify-between">
                <span>{totalGpusCount}</span>
                <Badge variant="outline" className="text-primary border-primary/30 font-mono text-[10px]">
                  {totalGpusCount} Active
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground">
              GPU compute accelerators
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 sm:p-5 pb-2">
              <CardDescription className="text-xs">Contributed VRAM</CardDescription>
              <CardTitle className="text-2xl font-bold text-primary font-mono">
                {allocatedUserVram.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">/ {totalUserVram.toFixed(1)} GB</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground">
              Active allocation ceiling
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 sm:p-5 pb-2">
              <CardDescription className="text-xs">Fleet Hourly Rate</CardDescription>
              <CardTitle className="text-2xl font-bold font-mono">
                ${combinedHourlyRate.toFixed(2)}
                <span className="text-xs font-normal text-muted-foreground">/hr</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground">
              Combined compute revenue
            </CardContent>
          </Card>

          <Card className="col-span-2 md:col-span-1">
            <CardHeader className="p-4 sm:p-5 pb-2">
              <CardDescription className="text-xs">Total Accrued Earnings</CardDescription>
              <CardTitle className="text-2xl font-bold font-mono text-emerald-400">
                ${totalUserEarnings.toFixed(4)}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 pt-0 text-[11px] text-muted-foreground flex justify-between items-center">
              <span>SLA balance</span>
              <Link to="/wallet" className="text-emerald-400 hover:underline">Wallet</Link>
            </CardContent>
          </Card>
        </div>

        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-border/80 pb-3">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Laptop className="h-4 w-4 text-emerald-400" />
              Active Physical Hardware Nodes
            </h2>
            <p className="text-xs text-muted-foreground">
              All computers and GPUs linked to your account. Control settings remotely from any device.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastHeartbeat && (
              <span className="font-mono text-[10px] text-muted-foreground">
                Synced {lastHeartbeat.toLocaleTimeString()}
              </span>
            )}
            <span className="text-xs text-muted-foreground font-mono">
              {myNodes.length} machine{myNodes.length === 1 ? "" : "s"} configured
            </span>
          </div>
        </div>

        {/* EMPTY STATE */}
        {myNodes.length === 0 && !isLoading && (
          <Card className="border-dashed border-2 py-12 text-center">
            <CardContent className="flex flex-col items-center justify-center max-w-md mx-auto space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-2">
                <Cpu className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-bold">No Physical GPUs Connected Yet</h3>
              <p className="text-xs text-muted-foreground">
                Click <strong>"Connect Machine / Add GPU"</strong> above to launch the lightweight agent on your Windows PC, Mac, or server.
              </p>
            </CardContent>
          </Card>
        )}

        {/* COMPACT CARD BLOCKS GRID (PREVIOUS BLOCK DESIGN) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {myNodes.map((w) => {
            const isAvailable = w.is_available ?? true;
            const isBusy = isAvailable && (w.status === "busy" || Boolean(w.current_task_id));
            const isOnline = isAvailable && w.status === "online" && !isBusy;
            const isPaused = !isAvailable;

            const systemGpus = w.gpus && w.gpus.length > 0
              ? w.gpus
              : [{
                  index: 0,
                  name: w.gpu_model || w.gpu_info || "GPU Accelerator",
                  vram_total_gb: w.gpu_memory_gb || w.vram_total_gb || 8.0,
                  vram_allocated_gb: w.vram_allocated_gb || 6.4,
                  vram_used_gb: w.vram_used_gb || 0.95,
                  vram_allocation_pct: w.vram_allocation_pct || 80,
                  gpu_utilization_pct: w.gpu_utilization_pct || 11.9,
                  status: w.status,
                  is_available: w.is_available,
                }];

            const vramAlloc = w.vram_allocated_gb || ((w.gpu_memory_gb || 8.0) * (w.vram_allocation_pct || 80)) / 100;
            const vramTotal = w.gpu_memory_gb || w.vram_total_gb || 8.0;

            const highlightColor = isBusy
              ? "bg-blue-500 animate-pulse"
              : isOnline
              ? "bg-emerald-500"
              : isPaused
              ? "bg-amber-500/70"
              : "bg-zinc-600";

            const dotColor = isBusy
              ? "bg-blue-400 animate-ping"
              : isOnline
              ? "bg-emerald-400 animate-pulse"
              : isPaused
              ? "bg-amber-500"
              : "bg-zinc-500";

            return (
              <Card key={w.node_id || w.id} className="border-border/80 bg-card/70 backdrop-blur-sm relative overflow-hidden shadow-sm flex flex-col justify-between">
                <div>
                  {/* Top highlight bar based on status */}
                  <div className={`h-1.5 w-full ${highlightColor}`} />

                  <CardHeader className="p-4 sm:p-5 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dotColor}`} />
                          <CardTitle className="text-base font-bold text-foreground truncate">
                            {w.system_name || w.name || w.gpu_model}
                          </CardTitle>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          Node ID: {w.node_id || w.id}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {isBusy ? (
                          <Badge variant="default" className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px] animate-pulse">
                            Busy • Working
                          </Badge>
                        ) : isOnline ? (
                          <Badge variant="default" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
                            Online • Ready
                          </Badge>
                        ) : isPaused ? (
                          <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
                            Paused
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-muted-foreground text-[10px]">
                            Offline
                          </Badge>
                        )}

                        {/* Always Silent Mode & Capacity Badge */}
                        {w.work_capacity_state === "restricted_pause" ? (
                          <Badge variant="secondary" className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px] font-mono flex items-center gap-1">
                            <Gamepad2 className="h-3 w-3 text-amber-400" />
                            Gaming Yield (0%)
                          </Badge>
                        ) : w.work_capacity_state === "stealth_regulated" || Boolean(w.is_always_silent) ? (
                          <Badge variant="secondary" className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 text-[10px] font-mono flex items-center gap-1">
                            <Moon className="h-3 w-3 text-cyan-400" />
                            Whisper Stealth ({w.duty_cycle_pct ?? 33}%)
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] font-mono flex items-center gap-1">
                            <Zap className="h-3 w-3 text-emerald-400" />
                            Unleashed (100%)
                          </Badge>
                        )}

                        {/* Remote Always Silent Toggle Button */}
                        <Button
                          size="sm"
                          variant="outline"
                          className={`h-7 px-2 text-[10px] font-mono gap-1.5 transition-all ${
                            Boolean(w.is_always_silent)
                              ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30"
                              : "text-muted-foreground hover:text-foreground border-border/60"
                          }`}
                          title={
                            Boolean(w.is_always_silent)
                              ? "Always Silent Mode ON: Whisper acoustic governor & automatic gaming yield active. Click to deactivate."
                              : "Always Silent Mode OFF: Max burst compute performance without acoustic regulation. Click to activate."
                          }
                          onClick={() => handleToggleAlwaysSilent(w.node_id || w.id, Boolean(w.is_always_silent))}
                          disabled={isUpdating}
                        >
                          {Boolean(w.is_always_silent) ? (
                            <Moon className="h-3 w-3 text-cyan-400 shrink-0" />
                          ) : (
                            <Zap className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                          <span>{Boolean(w.is_always_silent) ? "Silent: ON" : "Silent: OFF"}</span>
                        </Button>

                        {/* Remote Pause / Resume Toggle */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-7 p-0"
                          title={isPaused ? "Resume Machine (Start accepting compute jobs)" : "Pause Machine (Stop receiving new tasks)"}
                          onClick={() => handleToggleAvailability(w.node_id || w.id, isAvailable)}
                          disabled={isUpdating}
                        >
                          {isPaused ? <Play className="h-3.5 w-3.5 text-emerald-400" /> : <Pause className="h-3.5 w-3.5 text-amber-400" />}
                        </Button>

                        {/* Deregister Node */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          title="Remove / Unlink Machine"
                          onClick={() => handleDeregister(w.node_id || w.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-4 sm:p-5 pt-0 space-y-4">
                    {/* Hardware Specs Grid - 2x2 spacious responsive layout */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-muted/30 p-3.5 rounded-lg border font-mono">
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block font-sans">
                          GPU Accelerator
                        </span>
                        <span className="font-semibold text-foreground flex items-center gap-1.5 truncate">
                          <Cpu className="h-3.5 w-3.5 text-primary shrink-0" />
                          {w.gpu_model || w.gpu_info}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block font-sans">
                          CUDA / Framework
                        </span>
                        <span className="font-semibold text-foreground">
                          {w.cuda_version || "Metal / MPS"}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block font-sans">
                          CPU & System RAM
                        </span>
                        <span className="font-semibold text-foreground">
                          {w.cpu_cores} Cores • {w.memory_gb} GB RAM
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block font-sans">
                          Region & Ping Latency
                        </span>
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                          {w.region || "us-east"} • {w.latency_ping_ms ?? 12.0}ms
                        </span>
                      </div>
                    </div>

                    {/* Acoustic-Thermal Governor & Presence Telemetry Gauge */}
                    <div className="p-3 rounded-lg bg-muted/20 border border-border/60 text-xs space-y-2 font-mono">
                      <div className="flex items-center justify-between text-[11px] font-sans font-semibold text-foreground">
                        <span className="flex items-center gap-1.5">
                          <VolumeX className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                          Acoustic-Thermal Governor & Stealth Sensing
                        </span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          Boolean(w.is_always_silent)
                            ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                            : "bg-muted/40 text-muted-foreground border-border/40"
                        }`}>
                          {Boolean(w.is_always_silent) ? "Closed-Loop Active" : "Unregulated Standby"}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] text-muted-foreground pt-0.5">
                        <div className="space-y-0.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/80 block font-sans">
                            Input Activity
                          </span>
                          <span className="text-foreground font-semibold flex items-center gap-1">
                            <Clock className="h-3 w-3 text-cyan-400 shrink-0" />
                            {(w.input_idle_sec ?? 300) < 60
                              ? `${Math.round(w.input_idle_sec ?? 0)}s (Active User)`
                              : `${Math.round((w.input_idle_sec ?? 300) / 60)}m (Idle)`}
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/80 block font-sans">
                            GPU Core Temp
                          </span>
                          <span className="text-foreground font-semibold flex items-center gap-1">
                            <Thermometer className="h-3 w-3 text-amber-400 shrink-0" />
                            {(w.gpu_temp_c ?? 50.0).toFixed(1)}°C <span className="text-[10px] text-muted-foreground font-normal">/ 62°C Whisper Target</span>
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/80 block font-sans">
                            Compute Duty Cycle
                          </span>
                          <span className="text-foreground font-semibold flex items-center gap-1">
                            <Zap className="h-3 w-3 text-emerald-400 shrink-0" />
                            {w.duty_cycle_pct ?? 100}% Compute
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Remote VRAM Allocation Slider(s) */}
                    {systemGpus.length > 1 ? (
                      <div className="space-y-3 pt-1">
                        <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <Sliders className="h-3 w-3 text-primary" />
                          VRAM Allocation Controls ({systemGpus.length} GPUs)
                        </span>
                        {systemGpus.map((gpu, gIdx) => {
                          const gAlloc = gpu.vram_allocated_gb || ((gpu.vram_total_gb || 8.0) * (gpu.vram_allocation_pct || 80)) / 100;
                          const gTotal = gpu.vram_total_gb || 8.0;
                          const gPct = gpu.vram_allocation_pct || 80;
                          return (
                            <div key={`gpu-slider-${gpu.index ?? gIdx}`} className="space-y-1.5 p-2.5 rounded-md bg-muted/40 border">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-foreground flex items-center gap-1.5">
                                  <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px] font-mono h-4 px-1">
                                    GPU {gpu.index ?? gIdx}
                                  </Badge>
                                  <span className="truncate max-w-[140px]">{gpu.name || "GPU Card"}</span>
                                </span>
                                <span className="font-mono font-bold text-primary text-[11px]">
                                  {gPct}% ({gAlloc.toFixed(1)} / {gTotal.toFixed(1)} GB)
                                </span>
                              </div>
                              <Slider
                                value={gPct}
                                min={10}
                                max={100}
                                step={5}
                                disabled={isUpdating || !isOnline}
                                onValueChange={(val) => handleSliderChange(w.node_id || w.id, val, gpu.index ?? gIdx)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground flex items-center gap-1.5">
                            <Sliders className="h-3.5 w-3.5 text-primary" />
                            Remote VRAM Contribution Ceiling
                          </span>
                          <span className="font-mono font-bold text-primary">
                            {w.vram_allocation_pct || 80}% ({vramAlloc.toFixed(1)} / {vramTotal.toFixed(1)} GB)
                          </span>
                        </div>

                        <Slider
                          value={w.vram_allocation_pct || 80}
                          min={10}
                          max={100}
                          step={5}
                          disabled={isUpdating || !isOnline}
                          onValueChange={(val) => handleSliderChange(w.node_id || w.id, val, 0)}
                        />

                        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                          <span>10% (Low impact)</span>
                          <span>50% (Balanced)</span>
                          <span>100% (Dedicated)</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </div>

                {/* Machine Earnings & Telemetry footer */}
                <div className="flex items-center justify-between p-4 sm:p-5 pt-3 border-t text-xs bg-muted/10">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                    <span className="text-muted-foreground">Accrued:</span>
                    <span className="font-mono font-bold text-emerald-400">
                      ${(w.total_earnings_usd || 0).toFixed(4)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>Rate:</span>
                    <span className="font-mono font-semibold text-foreground">
                      ${(w.hourly_rate_usd || 0.45).toFixed(2)}/hr
                    </span>
                    <span>•</span>
                    <span>Tasks: {w.total_tasks_completed || 0}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
