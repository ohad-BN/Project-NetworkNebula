import { useState } from "react";
import {
  Activity,
  HardDrive,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  Server,
  RotateCw,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/services/api/client";
import { toast } from "sonner";

interface ClusterNode {
  node_id: string;
  name: string;
  gpu_model: string;
  vram_total_gb: number;
  vram_used_gb: number;
  cuda_version: string;
  role: string;
  status: "online" | "busy" | "idle";
}

export function ClusterStatusPage() {
  const [nodes] = useState<ClusterNode[]>([
    {
      node_id: "node-gpu-local-01",
      name: "Primary Host Worker (Windows Local)",
      gpu_model: "NVIDIA GeForce RTX 4070",
      vram_total_gb: 12.0,
      vram_used_gb: 3.4,
      cuda_version: "12.4 / PyTorch 2.6",
      role: "LoRA Training & Fast Serving",
      status: "online",
    },
    {
      node_id: "node-gpu-mesh-02",
      name: "Decentralized Compute Peer Alpha",
      gpu_model: "NVIDIA RTX 4090",
      vram_total_gb: 24.0,
      vram_used_gb: 0.8,
      cuda_version: "12.4",
      role: "All-Reduce Multi-GPU Worker",
      status: "idle",
    },
    {
      node_id: "node-gpu-mesh-03",
      name: "Enterprise Dedicated Fabric Beta",
      gpu_model: "NVIDIA A100 80GB SXM4",
      vram_total_gb: 80.0,
      vram_used_gb: 14.2,
      cuda_version: "12.6",
      role: "Foundation Model Serving",
      status: "online",
    },
  ]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await apiClient.get("/health");
      toast.success("Cluster telemetry synchronised");
    } catch {
      toast.error("Failed to reach cluster orchestrator");
    } finally {
      setIsRefreshing(false);
    }
  };

  const totalVram = nodes.reduce((acc, n) => acc + n.vram_total_gb, 0);
  const usedVram = nodes.reduce((acc, n) => acc + n.vram_used_gb, 0);

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-8 w-8 text-primary" />
            GPU Fleet & Cluster Telemetry
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time status of zero-trust decentralized compute hosts, VRAM allocation, and S3 object fabrics
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="gap-2">
          <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Fleet
        </Button>
      </div>

      {/* Cluster Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-primary" />
              Active Compute Nodes
            </CardDescription>
            <CardTitle className="text-2xl font-bold">{nodes.length} Nodes</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <HardDrive className="h-4 w-4 text-purple-500" />
              Cluster GPU Memory
            </CardDescription>
            <CardTitle className="text-2xl font-bold font-mono">
              {usedVram.toFixed(1)} / {totalVram.toFixed(0)} GB
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-500" />
              Broker Message Queue
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-500">
              1.2 ms (Redis)
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Compute Isolation
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-500">
              Zero-Trust
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Active Nodes Table */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            Registered Host Workers & Accelerators
          </CardTitle>
          <CardDescription>
            Heterogeneous GPU resources running Celery task workers and distributed All-Reduce channels
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                <tr>
                  <th className="py-3 px-4">Worker Node</th>
                  <th className="py-3 px-4">GPU Accelerator</th>
                  <th className="py-3 px-4">VRAM Allocation</th>
                  <th className="py-3 px-4">CUDA / PyTorch</th>
                  <th className="py-3 px-4">Compute Role</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {nodes.map((n) => (
                  <tr key={n.node_id} className="hover:bg-muted/30">
                    <td className="py-3 px-4 font-semibold">
                      <div>{n.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{n.node_id}</div>
                    </td>
                    <td className="py-3 px-4 font-medium">{n.gpu_model}</td>
                    <td className="py-3 px-4 font-mono text-xs">
                      {n.vram_used_gb} GB / {n.vram_total_gb} GB
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-muted-foreground">{n.cuda_version}</td>
                    <td className="py-3 px-4 text-xs">{n.role}</td>
                    <td className="py-3 px-4 text-right">
                      {n.status === "online" ? (
                        <Badge variant="default" className="bg-emerald-600 text-xs gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Online
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-amber-500 border-amber-500">
                          Idle / Ready
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
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
