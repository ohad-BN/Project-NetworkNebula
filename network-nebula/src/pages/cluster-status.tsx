import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  HardDrive,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  Server,
  RotateCw,
  Copy,
  Check,
  Sliders,
  Radio,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  workersService,
  type ClusterNodeTelemetry,
  type ClusterTelemetryResponse,
} from "@/services/api/workers";
import { toast } from "sonner";

export function ClusterStatusPage() {
  const [telemetry, setTelemetry] = useState<ClusterTelemetryResponse | null>(null);
  const [nodes, setNodes] = useState<ClusterNodeTelemetry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedJoinCmd, setCopiedJoinCmd] = useState(false);
  const [updatingNodeId, setUpdatingNodeId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch telemetry via REST API
  const fetchTelemetry = useCallback(async (showToast = false) => {
    try {
      setIsRefreshing(true);
      const data = await workersService.getClusterTelemetry();
      setTelemetry(data);
      // Sort: primary node first, then active/online nodes, then others
      const sorted = [...(data.nodes || [])].sort((a, b) => {
        if (a.node_id === "node-gpu-local-01") return -1;
        if (b.node_id === "node-gpu-local-01") return 1;
        if (a.status === "online" && b.status !== "online") return -1;
        if (b.status === "online" && a.status !== "online") return 1;
        return (b.total_earnings_usd || 0) - (a.total_earnings_usd || 0);
      });
      setNodes(sorted);
      if (showToast) {
        toast.success(`Cluster fleet synced (${sorted.length} nodes active)`);
      }
    } catch (err) {
      console.error("Failed to fetch cluster telemetry:", err);
      if (showToast) {
        toast.error("Failed to connect to cluster orchestrator");
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Connect to live WebSocket cluster broadcast stream
  useEffect(() => {
    fetchTelemetry(false);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname || "localhost";
    const wsUrl = `${protocol}//${host}:8000/ws/cluster`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          if (event.data === "pong") return;
          const msg = JSON.parse(event.data);
          if (msg.type === "telemetry_snapshot" && msg.nodes) {
            setTelemetry((prev) => ({
              ...(prev || {
                status: "healthy",
                active_nodes: msg.active_nodes || 0,
                total_vram_gb: msg.total_vram_gb || 0,
                allocated_vram_gb: msg.total_allocated_vram_gb || 0,
                used_vram_gb: 0,
                avg_utilization_pct: 0,
                redis_latency_ms: 1.2,
                compute_isolation: "Zero-Trust CUDA Fraction Enforced",
                nodes: [],
              }),
              active_nodes: msg.active_nodes,
              total_vram_gb: msg.total_vram_gb,
              allocated_vram_gb: msg.total_allocated_vram_gb,
            }));
            const sorted = [...msg.nodes].sort((a: ClusterNodeTelemetry, b: ClusterNodeTelemetry) => {
              if (a.node_id === "node-gpu-local-01") return -1;
              if (b.node_id === "node-gpu-local-01") return 1;
              if (a.status === "online" && b.status !== "online") return -1;
              if (b.status === "online" && a.status !== "online") return 1;
              return (b.total_earnings_usd || 0) - (a.total_earnings_usd || 0);
            });
            setNodes(sorted);
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
      };

      ws.onerror = () => {
        setWsConnected(false);
      };
    } catch {
      setWsConnected(false);
    }

    // Ping WebSocket every 15s to keep alive
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send("ping");
      }
    }, 15000);

    return () => {
      clearInterval(pingInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchTelemetry]);

  // Handle dynamic GPU slider adjustment
  const handleSliderChange = async (nodeId: string, newPct: number) => {
    // Optimistic UI update
    setNodes((prev) =>
      prev.map((n) => {
        if (n.node_id === nodeId || n.id === nodeId) {
          const alloc = Number(((n.vram_total_gb * newPct) / 100).toFixed(2));
          return {
            ...n,
            vram_allocation_pct: newPct,
            vram_allocated_gb: alloc,
          };
        }
        return n;
      })
    );

    try {
      setUpdatingNodeId(nodeId);
      const res = await workersService.updateConfig(nodeId, {
        vram_allocation_pct: newPct,
      });
      toast.success(
        `Throttled ${nodeId}: ${newPct}% ceiling (${res.vram_allocated_gb} GB VRAM enforced)`
      );
    } catch (err) {
      console.error("Failed to update worker config:", err);
      toast.error(`Failed to adjust GPU limit for ${nodeId}`);
      fetchTelemetry(false);
    } finally {
      setUpdatingNodeId(null);
    }
  };

  const copyJoinCommand = () => {
    const cmd = "python nebula_worker.py join --server http://localhost:8000 --vram-pct 80 --tunnel";
    navigator.clipboard.writeText(cmd);
    setCopiedJoinCmd(true);
    toast.success("Worker join command copied to clipboard!");
    setTimeout(() => setCopiedJoinCmd(false), 2500);
  };

  const totalVram = telemetry?.total_vram_gb || nodes.reduce((acc, n) => acc + (n.vram_total_gb || 0), 0);
  const allocatedVram = telemetry?.allocated_vram_gb || nodes.reduce((acc, n) => acc + (n.vram_allocated_gb || 0), 0);
  const clusterEarnings = nodes.reduce((acc, n) => acc + (n.total_earnings_usd || 0), 0);
  const totalStakedCollateral = nodes.reduce((acc, n) => acc + (n.staked_amount_usd || 0), 0);

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Activity className="h-8 w-8 text-primary" />
              Live GPU Fleet & Cluster Telemetry
            </h1>
            {wsConnected ? (
              <Badge variant="default" className="bg-emerald-600 gap-1 text-xs">
                <Radio className="h-3 w-3 animate-pulse" /> Live WebSocket
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-xs">
                Polling Mode
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            Real-time status of decentralized compute hosts, collateral-backed node staking, dynamic 10%–100% VRAM contribution sliders, and S3 object fabrics
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchTelemetry(true)}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh Fleet
          </Button>
        </div>
      </div>

      {/* Cluster Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-primary" />
              Compute Nodes
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{nodes.length} Active</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <HardDrive className="h-4 w-4 text-purple-500" />
              GPU Allocation
            </CardDescription>
            <CardTitle className="text-xl font-bold font-mono">
              {allocatedVram.toFixed(1)} / {totalVram.toFixed(0)} GB
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              Collateral Staked
            </CardDescription>
            <CardTitle className="text-xl font-bold font-mono text-purple-500">
              ${totalStakedCollateral.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-emerald-500" />
              SLA Availability
            </CardDescription>
            <CardTitle className="text-xl font-bold text-emerald-500 font-mono">
              99.9% Target
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              Cluster Earned
            </CardDescription>
            <CardTitle className="text-xl font-bold text-emerald-500 font-mono">
              ${clusterEarnings.toFixed(4)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Quick Join CLI Terminal Widget */}
      <Card className="mb-8 border-primary/30 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              Connect a New GPU Worker Node to Fleet
            </CardTitle>
            <Button
              variant="secondary"
              size="sm"
              onClick={copyJoinCommand}
              className="gap-1.5 h-8 text-xs font-mono"
            >
              {copiedJoinCmd ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
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
          <CardDescription>
            Run this command in Windows PowerShell or Linux terminal to join the decentralized compute mesh:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-slate-950 text-slate-100 p-3 rounded-md font-mono text-xs overflow-x-auto border border-slate-800 flex items-center justify-between">
            <code>python nebula_worker.py join --server http://localhost:8000 --vram-pct 80 --tunnel</code>
          </div>
        </CardContent>
      </Card>

      {/* Active Nodes Table with Interactive Sliders */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-primary" />
                Registered GPU Worker Nodes & Contribution Controls
              </CardTitle>
              <CardDescription>
                Adjust each GPU node's active memory contribution percentage (10%–100%) in real time
              </CardDescription>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              Showing top {Math.min(nodes.length, 25)} of {nodes.length} nodes
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                <tr>
                  <th className="py-3 px-4">Worker Node</th>
                  <th className="py-3 px-4">Region & Latency</th>
                  <th className="py-3 px-4">Staked & Reputation</th>
                  <th className="py-3 px-4">GPU Hardware</th>
                  <th className="py-3 px-4 min-w-[180px]">GPU Contribution Slider (10%-100%)</th>
                  <th className="py-3 px-4">VRAM Ceiling</th>
                  <th className="py-3 px-4">Earned</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {nodes.length > 0 ? (
                  nodes.slice(0, 25).map((n) => {
                    const allocPct = n.vram_allocation_pct ?? 80;
                    const isUpdating = updatingNodeId === n.node_id;
                    const ping = n.latency_ping_ms ?? 15.0;

                    return (
                      <tr key={n.node_id || n.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-foreground flex items-center gap-2">
                            {n.name || "GPU Worker"}
                            {n.tunnel_active && (
                              <Badge variant="outline" className="text-[10px] py-0 text-emerald-500 border-emerald-500/40">
                                Tunnel WS
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {n.node_id || n.id}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] uppercase font-mono">
                              {n.region || "us-east"}
                            </Badge>
                            <span className={`text-[11px] font-mono ${ping <= 15 ? "text-emerald-500 font-semibold" : "text-amber-500"}`}>
                              ⚡ {ping.toFixed(1)}ms
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            {(n.staked_amount_usd || 0) > 0 ? (
                              <Badge className="bg-purple-600 text-[10px] font-mono">
                                ${(n.staked_amount_usd || 0).toFixed(0)} Staked
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground text-[10px]">
                                Unstaked
                              </Badge>
                            )}
                            <span className="text-xs font-mono text-muted-foreground">
                              {(n.reputation_score || 100).toFixed(0)}% Rep
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-xs">{n.gpu_model || n.gpu_info}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            CUDA: {n.cuda_version || "12.8"}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="space-y-1 max-w-[200px]">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-foreground">
                                {allocPct}%
                              </span>
                              <span className="text-muted-foreground font-mono text-[11px]">
                                {n.vram_allocated_gb?.toFixed(1) || (n.vram_total_gb * allocPct / 100).toFixed(1)} / {n.vram_total_gb?.toFixed(1)} GB
                              </span>
                            </div>
                            <Slider
                              value={allocPct}
                              min={10}
                              max={100}
                              step={5}
                              disabled={isUpdating}
                              onValueChange={(val) => handleSliderChange(n.node_id || n.id, val)}
                              className="cursor-pointer"
                            />
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">
                          {n.vram_allocated_gb?.toFixed(1) || 6.4} GB
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-emerald-500">
                          ${(n.total_earnings_usd || 0).toFixed(4)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {n.status === "online" ? (
                            <Badge variant="default" className="bg-emerald-600 text-xs gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Online
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-amber-500 border-amber-500">
                              Offline
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No worker nodes registered yet. Run the join command above to connect!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Storage Fabric Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" />
            MinIO S3 Enterprise Buckets Fabric
          </CardTitle>
          <CardDescription>
            Multi-bucket storage layout for fine-tuning artifacts and checkpoint isolation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3 border rounded-md bg-muted/20">
              <div className="font-semibold text-xs flex items-center justify-between">
                <span>nebula-datasets</span>
                <Badge variant="default" className="bg-emerald-600 text-[10px]">Active</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Tenant training datasets & presigned upload targets</p>
            </div>
            <div className="p-3 border rounded-md bg-muted/20">
              <div className="font-semibold text-xs flex items-center justify-between">
                <span>nebula-checkpoints</span>
                <Badge variant="default" className="bg-emerald-600 text-[10px]">Active</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">LoRA & QLoRA safetensors adapter weights</p>
            </div>
            <div className="p-3 border rounded-md bg-muted/20">
              <div className="font-semibold text-xs flex items-center justify-between">
                <span>nebula-models</span>
                <Badge variant="default" className="bg-emerald-600 text-[10px]">Active</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Foundation base model weight cache</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
export default ClusterStatusPage;
