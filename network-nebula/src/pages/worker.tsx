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
  Radio,
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
  Server,
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

  const [activeTab, setActiveTab] = useState<"my_fleet" | "global_mesh">("my_fleet");
  const [myNodes, setMyNodes] = useState<ClusterNodeTelemetry[]>([]);
  const [globalNodes, setGlobalNodes] = useState<ClusterNodeTelemetry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(new Date());
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  const loadWorkerData = useCallback(async () => {
    try {
      // 1. Load user's private fleet
      const userFleet = await workersService.getUserWorkers();
      const userNodes = userFleet.nodes || [];
      setMyNodes(userNodes);

      // 2. Load global cluster telemetry
      const globalFleet = await workersService.getClusterTelemetry();
      const allClusterNodes = globalFleet.nodes || [];
      setGlobalNodes(allClusterNodes);

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

  // Handle remote slider adjustment for a specific machine
  const handleSliderChange = async (targetWorkerId: string, newPct: number) => {
    // Optimistic update
    setMyNodes((prev) =>
      prev.map((n) =>
        (n.node_id === targetWorkerId || n.id === targetWorkerId)
          ? {
              ...n,
              vram_allocation_pct: newPct,
              vram_allocated_gb: Number(((n.vram_total_gb * newPct) / 100).toFixed(2)),
            }
          : n
      )
    );

    try {
      setIsUpdating(true);
      const res = await workersService.updateConfig(targetWorkerId, {
        vram_allocation_pct: newPct,
      });
      toast.success(
        `Adjusted ${targetWorkerId} to ${newPct}% (${res.vram_allocated_gb} GB VRAM allocated)`
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
      toast.success(currentAvailable ? "Worker paused (offline for compute)" : "Worker resumed & accepting compute jobs");
      await loadWorkerData();
    } catch {
      toast.error("Failed to update node status");
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle Deregister
  const handleDeregister = async (targetWorkerId: string) => {
    if (!confirm(`Are you sure you want to remove worker node '${targetWorkerId}' from your account?`)) return;
    try {
      await workersService.deregister(targetWorkerId);
      toast.success("Worker node removed");
      await loadWorkerData();
    } catch {
      toast.error("Failed to remove worker node");
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
  const activeNodesCount = myNodes.filter((n) => n.status === "online" && n.is_available).length;
  const combinedHourlyRate = myNodes.reduce((acc, n) => acc + (n.hourly_rate_usd || 0.45), 0);

  // Connection commands
  const originUrl = window.location.origin.includes("localhost:5173")
    ? "http://localhost:8000"
    : window.location.origin;

  const powershellBootstrapper = `powershell -c "irm ${originUrl}/connect.ps1?key=${apiKey} | iex"`;
  const powershellLocalCmd = `python nebula_worker.py join --server ${originUrl} --api-key ${apiKey} --tunnel`;
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
                Decentralized Compute Host Portal
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight mt-1">
              GPU Fleet & Host Provider Console
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Contribute GPU compute from your Windows PCs, Apple Silicon Macs, or cloud rigs to earn compute credits & USDC.
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
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <Cpu className="h-5 w-5 text-emerald-500" />
                    Connect GPU Hardware to Your Account
                  </DialogTitle>
                  <DialogDescription>
                    Follow the simple guide below to launch the lightweight agent on your machine. Your hardware will automatically link to your account.
                  </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="windows" className="pt-2">
                  <TabsList className="grid grid-cols-2 mb-4">
                    <TabsTrigger value="windows" className="gap-2 text-xs">
                      <Monitor className="h-4 w-4" /> Windows (PowerShell)
                    </TabsTrigger>
                    <TabsTrigger value="macos" className="gap-2 text-xs">
                      <Laptop className="h-4 w-4" /> macOS / Linux (Terminal)
                    </TabsTrigger>
                  </TabsList>

                  {/* Windows Tab */}
                  <TabsContent value="windows" className="space-y-4 text-xs">
                    <div className="p-3 bg-muted/40 rounded-lg border space-y-2">
                      <p className="font-semibold text-foreground flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[11px] font-bold">1</span>
                        Open PowerShell on your Windows PC
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        Requires Python 3.10+ and NVIDIA CUDA drivers.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-bold">2</span>
                          Run the 1-Click PowerShell Connector
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">Pre-authenticated with your key</span>
                      </div>

                      <div className="flex items-center justify-between bg-slate-950 text-slate-100 p-2.5 rounded-lg font-mono text-[11px] border border-slate-800">
                        <span className="truncate mr-2">{powershellBootstrapper}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-slate-300 hover:text-white shrink-0"
                          onClick={() => copyToClipboard(powershellBootstrapper, "ps-boot")}
                        >
                          {copiedCmd === "ps-boot" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-1.5">
                      <span className="text-muted-foreground text-[11px]">Or if already inside the project directory:</span>
                      <div className="flex items-center justify-between bg-slate-950 text-slate-100 p-2.5 rounded-lg font-mono text-[11px] border border-slate-800">
                        <span className="truncate mr-2">{powershellLocalCmd}</span>
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
                    <div className="p-3 bg-muted/40 rounded-lg border space-y-2">
                      <p className="font-semibold text-foreground flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[11px] font-bold">1</span>
                        Open Terminal on your Mac or Linux Server
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        Supports Apple Silicon M1/M2/M3/M4 via Metal Performance Shaders (MPS) or Linux NVIDIA CUDA.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-bold">2</span>
                          Run the 1-Click Terminal Connector
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">Pre-authenticated with your key</span>
                      </div>

                      <div className="flex items-center justify-between bg-slate-950 text-slate-100 p-2.5 rounded-lg font-mono text-[11px] border border-slate-800">
                        <span className="truncate mr-2">{bashBootstrapper}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-slate-300 hover:text-white shrink-0"
                          onClick={() => copyToClipboard(bashBootstrapper, "sh-boot")}
                        >
                          {copiedCmd === "sh-boot" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-1.5">
                      <span className="text-muted-foreground text-[11px]">Or if already inside the project directory:</span>
                      <div className="flex items-center justify-between bg-slate-950 text-slate-100 p-2.5 rounded-lg font-mono text-[11px] border border-slate-800">
                        <span className="truncate mr-2">{bashLocalCmd}</span>
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

        {/* View Switcher: My Hardware Fleet vs Global Network Mesh */}
        <div className="flex items-center justify-between border-b border-border/80 pb-3">
          <div className="flex items-center gap-2 bg-muted/60 p-1 rounded-lg border text-xs font-medium">
            <button
              onClick={() => setActiveTab("my_fleet")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                activeTab === "my_fleet"
                  ? "bg-background text-foreground shadow-sm font-semibold border border-emerald-500/30 text-emerald-400"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              }`}
            >
              <Server className="h-3.5 w-3.5" />
              <span>My Contributed Hardware ({myNodes.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("global_mesh")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                activeTab === "global_mesh"
                  ? "bg-background text-foreground shadow-sm font-semibold border border-primary/30 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              <span>Global Network Mesh ({globalNodes.length})</span>
            </button>
          </div>

          <div className="text-xs text-muted-foreground hidden sm:block">
            {lastHeartbeat && `Telemetry synced: ${lastHeartbeat.toLocaleTimeString()}`}
          </div>
        </div>

        {/* TAB 1: MY HARDWARE FLEET */}
        {activeTab === "my_fleet" && (
          <div className="space-y-6">
            
            {/* Top Metric Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Connected Machines</CardDescription>
                  <CardTitle className="text-2xl font-bold flex items-center justify-between">
                    <span>{myNodes.length}</span>
                    <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 font-mono text-[10px]">
                      {activeNodesCount} Online
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] text-muted-foreground">
                  Linked to your account
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Contributed VRAM</CardDescription>
                  <CardTitle className="text-2xl font-bold text-primary font-mono">
                    {allocatedUserVram.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">/ {totalUserVram.toFixed(1)} GB</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] text-muted-foreground">
                  Active allocation ceiling
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Combined Compute Rate</CardDescription>
                  <CardTitle className="text-2xl font-bold font-mono">
                    ${combinedHourlyRate.toFixed(2)}
                    <span className="text-xs font-normal text-muted-foreground">/hr</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] text-muted-foreground">
                  Automatic SLA earnings
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Total Accrued Earnings</CardDescription>
                  <CardTitle className="text-2xl font-bold font-mono text-emerald-400">
                    ${totalUserEarnings.toFixed(4)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] text-muted-foreground flex justify-between items-center">
                  <span>SLA credited balance</span>
                  <Link to="/wallet" className="text-emerald-400 hover:underline">Wallet</Link>
                </CardContent>
              </Card>
            </div>

            {/* EMPTY STATE (If 0 machines connected) */}
            {myNodes.length === 0 && (
              <Card className="border-dashed border-2 py-12 text-center">
                <CardContent className="flex flex-col items-center justify-center max-w-md mx-auto space-y-4">
                  <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-2">
                    <Cpu className="h-8 w-8" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-lg font-bold">No GPU Hardware Connected Yet</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Connect your Windows desktop, gaming laptop, or Apple Silicon Mac to begin contributing compute to the network and earning rewards.
                    </p>
                  </div>
                  <Button
                    onClick={() => setIsConnectModalOpen(true)}
                    className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold text-xs shadow-md"
                  >
                    <Plus className="h-4 w-4" />
                    Connect Your First Machine
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* GRID OF INDIVIDUAL CONNECTED MACHINES */}
            {myNodes.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <Laptop className="h-4 w-4 text-emerald-400" />
                    Active Physical Hardware Nodes
                  </h2>
                  <span className="text-xs text-muted-foreground font-mono">
                    Control settings remotely across all computers
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {myNodes.map((w) => {
                    const isOnline = w.status === "online" && w.is_available;
                    const vramAlloc = w.vram_allocated_gb || ((w.gpu_memory_gb || 8.0) * (w.vram_allocation_pct || 80)) / 100;
                    const vramTotal = w.gpu_memory_gb || w.vram_total_gb || 8.0;

                    return (
                      <Card key={w.node_id || w.id} className="border-border/80 bg-card/70 backdrop-blur-sm relative overflow-hidden">
                        {/* Top highlight bar based on status */}
                        <div className={`h-1 w-full ${isOnline ? "bg-emerald-500" : "bg-amber-500/70"}`} />

                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-amber-500"}`} />
                                <CardTitle className="text-base font-bold truncate max-w-[280px]">
                                  {w.name || w.gpu_model}
                                </CardTitle>
                              </div>
                              <p className="text-xs text-muted-foreground font-mono">
                                Node ID: {w.node_id || w.id}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <Badge variant={isOnline ? "default" : "secondary"} className={isOnline ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]" : "text-[10px]"}>
                                {isOnline ? "Online • Active" : "Paused • Offline"}
                              </Badge>

                              {/* Remote Pause / Resume Toggle */}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-7 p-0"
                                title={isOnline ? "Pause Node (Stop receiving tasks)" : "Resume Node (Start accepting tasks)"}
                                onClick={() => handleToggleAvailability(w.node_id || w.id, w.is_available)}
                                disabled={isUpdating}
                              >
                                {isOnline ? <Pause className="h-3.5 w-3.5 text-amber-400" /> : <Play className="h-3.5 w-3.5 text-emerald-400" />}
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

                        <CardContent className="space-y-4">
                          {/* Hardware Specs Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border font-mono">
                            <div>
                              <span className="text-[10px] text-muted-foreground block font-sans">GPU Accelerator</span>
                              <span className="font-semibold text-foreground truncate block">{w.gpu_model || w.gpu_info}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-muted-foreground block font-sans">CUDA / Framework</span>
                              <span className="font-semibold text-foreground">{w.cuda_version || "Metal / MPS"}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-muted-foreground block font-sans">CPU & RAM</span>
                              <span className="font-semibold text-foreground">{w.cpu_cores} cores • {w.memory_gb}GB</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-muted-foreground block font-sans">Region & Latency</span>
                              <span className="font-semibold text-foreground">{w.region || "us-east"} • {w.latency_ping_ms ?? 12.0}ms</span>
                            </div>
                          </div>

                          {/* Remote VRAM Allocation Slider */}
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
                              onValueChange={(val) => handleSliderChange(w.node_id || w.id, val)}
                            />

                            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                              <span>10% (Low impact)</span>
                              <span>50% (Balanced)</span>
                              <span>100% (Dedicated)</span>
                            </div>
                          </div>

                          {/* Machine Earnings & Telemetry footer */}
                          <div className="flex items-center justify-between pt-2 border-t text-xs">
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-emerald-400" />
                              <span className="text-muted-foreground">Accrued:</span>
                              <span className="font-mono font-bold text-emerald-400">
                                ${(w.total_earnings_usd || 0).toFixed(4)}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span>Rate:</span>
                              <span className="font-mono font-semibold text-foreground">${(w.hourly_rate_usd || 0.45).toFixed(2)}/hr</span>
                              <span>•</span>
                              <span>Tasks:</span>
                              <span className="font-mono font-semibold text-foreground">{w.total_tasks_completed || 0}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: GLOBAL NETWORK MESH (Cluster-Wide Telemetry) */}
        {activeTab === "global_mesh" && (
          <div className="space-y-6">
            <div className="border rounded-lg overflow-hidden bg-card">
              <div className="p-4 bg-muted/40 border-b flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">Decentralized P2P Cluster Mesh Telemetry</h3>
                  <p className="text-xs text-muted-foreground">Aggregated peer nodes actively providing compute across all geographic regions</p>
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  {globalNodes.length} Verified Nodes
                </Badge>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 text-muted-foreground border-b uppercase font-mono text-[10px]">
                    <tr>
                      <th className="p-3">Worker Node</th>
                      <th className="p-3">Region & Latency</th>
                      <th className="p-3">GPU Hardware</th>
                      <th className="p-3">VRAM Ceiling</th>
                      <th className="p-3">Rate</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {globalNodes.map((n) => (
                      <tr key={n.node_id || n.id} className="hover:bg-muted/20">
                        <td className="p-3 font-semibold font-mono text-foreground">
                          {n.name || n.node_id}
                        </td>
                        <td className="p-3 font-mono">
                          {n.region || "us-east"} ({n.latency_ping_ms ?? 15.0}ms)
                        </td>
                        <td className="p-3">
                          {n.gpu_model || n.gpu_info}
                        </td>
                        <td className="p-3 font-mono">
                          {n.vram_allocated_gb?.toFixed(1) || ((n.gpu_memory_gb || 8) * 0.8).toFixed(1)} / {n.gpu_memory_gb || 8} GB ({n.vram_allocation_pct || 80}%)
                        </td>
                        <td className="p-3 font-mono text-emerald-400">
                          ${(n.hourly_rate_usd || 0.45).toFixed(2)}/hr
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className={n.status === "online" ? "text-emerald-400 border-emerald-500/30" : ""}>
                            {n.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default WorkerDashboardPage;
