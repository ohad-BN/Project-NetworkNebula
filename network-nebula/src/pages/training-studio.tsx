import { useEffect, useState } from "react";
import {
  Cpu,
  Layers,
  Play,
  RotateCw,
  Download,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Database,
  Sliders,
  TrendingDown,
  UploadCloud,
  Server,
  Network,
  Zap,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiClient } from "@/services/api/client";
import { toast } from "sonner";

interface ClusterNodeItem {
  node_id: string;
  name: string;
  gpu_model: string;
  vram_total_gb: number;
  vram_allocated_gb: number;
  vram_allocation_pct: number;
  status: string;
  is_available: boolean;
  region?: string;
  hourly_rate_usd?: number;
}

interface TrainingJobItem {
  id: string;
  name: string;
  base_model: string;
  train_type: string;
  parallelism: string;
  num_gpus: number;
  dataset_s3_url: string;
  hyperparameters: Record<string, any>;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  current_epoch: number;
  total_epochs: number;
  loss_history: Array<{ epoch: number; step: number; loss: number; val_loss?: number; timestamp: string }>;
  checkpoints: Array<{ epoch: number; s3_url: string; size_bytes: number; created_at: string }>;
  final_adapter_url?: string;
  cost: number;
  created_at?: string;
  completed_at?: string;
}

export function TrainingStudioPage() {
  const [jobs, setJobs] = useState<TrainingJobItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<TrainingJobItem | null>(null);
  const [isTelemetryModalOpen, setIsTelemetryModalOpen] = useState(false);

  // Form State
  const [jobName, setJobName] = useState("");
  const [baseModel, setBaseModel] = useState("Qwen/Qwen2.5-0.5B-Instruct");
  const [trainType, setTrainType] = useState("lora");
  const [datasetUrl, setDatasetUrl] = useState("http://localhost:9000/nebula-datasets/enterprise/real_alpaca_dataset.jsonl");
  const [epochs, setEpochs] = useState("3");
  const [learningRate, setLearningRate] = useState("0.0002");
  const [loraR, setLoraR] = useState("16");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingUpload, setIsGeneratingUpload] = useState(false);

  // Fleet & Autonomous Compute Distribution State
  const [clusterNodes, setClusterNodes] = useState<ClusterNodeItem[]>([]);
  const [computeStrategy, setComputeStrategy] = useState<"auto_swarm" | "ring_mesh" | "single">("auto_swarm");
  const [gpuScale, setGpuScale] = useState<"auto" | "2" | "4">("auto");
  const [devOverrideNodeId, setDevOverrideNodeId] = useState<string>("");
  const [showDevOverride, setShowDevOverride] = useState<boolean>(false);

  // Derived cluster capacity
  const onlineNodes = clusterNodes.filter((n) => n.status === "online" && n.is_available !== false);
  const totalOnlineVram = onlineNodes.reduce((acc, n) => acc + (n.vram_allocated_gb || n.vram_total_gb || 0), 0);

  const fetchJobs = async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get<TrainingJobItem[]>("/api/v1/training/jobs");
      setJobs(res.data);
    } catch (err: any) {
      toast.error("Failed to fetch training jobs");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchClusterNodes = async () => {
    try {
      const res = await apiClient.get("/api/v1/cluster/telemetry?scope=all");
      const nodes = (res.data?.nodes || []) as ClusterNodeItem[];
      setClusterNodes(nodes);
    } catch (err) {
      // Ignore telemetry fetch errors
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchClusterNodes();
    const interval = setInterval(() => {
      fetchJobs();
      fetchClusterNodes();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleGenerateUploadUrl = async () => {
    try {
      setIsGeneratingUpload(true);
      const res = await apiClient.post("/api/v1/training/datasets/upload-url", {
        filename: "dataset_enterprise.jsonl"
      });
      setDatasetUrl(res.data.s3_url);
      toast.success("Dataset upload URL generated and assigned to S3 path");
    } catch (err: any) {
      toast.error("Could not generate S3 dataset URL");
    } finally {
      setIsGeneratingUpload(false);
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const isSingle = computeStrategy === "single";
      let targetGpus = 1;
      if (!isSingle) {
        if (gpuScale === "auto") {
          targetGpus = Math.max(2, onlineNodes.length);
        } else {
          targetGpus = parseInt(gpuScale, 10);
        }
      }
      const isDistributed = !isSingle && targetGpus >= 2;
      const targetWorkerIds = devOverrideNodeId ? [devOverrideNodeId] : undefined;

      const payload = {
        name: jobName.trim() || undefined,
        base_model: baseModel,
        train_type: trainType,
        parallelism: computeStrategy === "ring_mesh" ? "model_parallel" : "data_parallel",
        num_gpus: isDistributed ? targetGpus : 1,
        worker_ids: targetWorkerIds,
        dataset_s3_url: datasetUrl,
        total_epochs: parseInt(epochs, 10) || 3,
        hyperparameters: {
          learning_rate: parseFloat(learningRate) || 0.0002,
          batch_size: 4,
          lora_r: parseInt(loraR, 10) || 16,
          lora_alpha: 32,
          compute_strategy: computeStrategy,
          worker_ids: targetWorkerIds,
        }
      };

      const endpoint = isDistributed ? "/api/v1/training/distributed/jobs" : "/api/v1/training/jobs";
      await apiClient.post(endpoint, payload);
      toast.success(
        isDistributed
          ? `Decentralized training job dispatched across ${targetGpus} nodes via autonomous consensus!`
          : "Training job submitted to optimal sovereign worker node"
      );
      setIsSubmitModalOpen(false);
      setJobName("");
      fetchJobs();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to submit training job");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await apiClient.post(`/api/v1/training/jobs/${jobId}/cancel`);
      toast.info("Training job cancelled");
      fetchJobs();
      if (selectedJob?.id === jobId) {
        setIsTelemetryModalOpen(false);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to cancel job");
    }
  };

  const openTelemetry = (job: TrainingJobItem) => {
    setSelectedJob(job);
    setIsTelemetryModalOpen(true);
  };

  const getStatusBadge = (status: TrainingJobItem["status"]) => {
    switch (status) {
      case "completed":
        return <Badge variant="default" className="bg-emerald-600 gap-1"><CheckCircle2 className="h-3 w-3" /> Completed</Badge>;
      case "running":
        return <Badge variant="secondary" className="bg-sky-600 text-white animate-pulse gap-1"><RotateCw className="h-3 w-3 animate-spin" /> Running</Badge>;
      case "queued":
        return <Badge variant="outline" className="border-amber-500 text-amber-500 gap-1"><Clock className="h-3 w-3" /> Queued</Badge>;
      case "cancelled":
        return <Badge variant="outline" className="text-muted-foreground gap-1"><XCircle className="h-3 w-3" /> Cancelled</Badge>;
      default:
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Failed</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-8 w-8 text-primary" />
            Enterprise Training Studio
          </h1>
          <p className="text-muted-foreground mt-1">
            Fine-tune foundation models (LoRA, QLoRA) on decentralized GPU clusters with real-time loss telemetry
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchJobs} className="gap-2">
            <RotateCw className="h-4 w-4" />
            Refresh
          </Button>
          <Dialog open={isSubmitModalOpen} onOpenChange={setIsSubmitModalOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Play className="h-4 w-4 fill-current" />
                Launch Training Run
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Launch Enterprise Fine-Tuning Run</DialogTitle>
                <DialogDescription>
                  Configure hyperparameters and dataset source. Workload will be routed across available GPU hosts.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateJob} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="jobName">Job Name (Optional)</Label>
                  <Input
                    id="jobName"
                    placeholder="e.g. LegalDocs-Llama3-v1"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="baseModel">Base Foundation Model</Label>
                    <select
                      id="baseModel"
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring"
                      value={baseModel}
                      onChange={(e) => setBaseModel(e.target.value)}
                    >
                      <option value="Qwen/Qwen2.5-0.5B-Instruct">Qwen/Qwen2.5-0.5B (Active Local Hardware)</option>
                      <option value="Qwen/Qwen2.5-1.5B-Instruct">Qwen/Qwen2.5-1.5B (Active Local Hardware)</option>
                      <option value="Qwen/Qwen2.5-7B-Instruct">Qwen/Qwen2.5-7B (Production Fine-Tuning)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="trainType">Fine-Tuning Method</Label>
                    <select
                      id="trainType"
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring"
                      value={trainType}
                      onChange={(e) => setTrainType(e.target.value)}
                    >
                      <option value="lora">LoRA (Low-Rank Adaptation)</option>
                      <option value="qlora">QLoRA (4-bit Quantized)</option>
                      <option value="full">Full Fine-Tuning</option>
                    </select>
                  </div>
                </div>

                {/* Autonomous Decentralized Compute Distribution */}
                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <Network className="h-4 w-4 text-primary" />
                      Autonomous Compute Fleet Strategy
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    </Label>
                    <Badge variant="outline" className="text-xs font-mono bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
                      {onlineNodes.length} Verified Online
                    </Badge>
                  </div>

                  {/* 3 Strategy Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setComputeStrategy("auto_swarm")}
                      className={`relative flex flex-col p-3 rounded-lg border text-left transition-all cursor-pointer ${
                        computeStrategy === "auto_swarm"
                          ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/40"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 text-foreground font-semibold text-xs">
                          <Zap className="h-3.5 w-3.5 text-amber-400" />
                          <span>Auto-Swarm</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary">
                          Recommended
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Dynamic multi-node dataset sharding across decentralized workers.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setComputeStrategy("ring_mesh")}
                      className={`relative flex flex-col p-3 rounded-lg border text-left transition-all cursor-pointer ${
                        computeStrategy === "ring_mesh"
                          ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/40"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 text-foreground font-semibold text-xs">
                          <Server className="h-3.5 w-3.5 text-cyan-400" />
                          <span>Ring Mesh</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          &lt;25ms RTT
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Low-latency Ring All-Reduce synchronous peer-to-peer gradient topology.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setComputeStrategy("single")}
                      className={`relative flex flex-col p-3 rounded-lg border text-left transition-all cursor-pointer ${
                        computeStrategy === "single"
                          ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/40"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 text-foreground font-semibold text-xs">
                          <Cpu className="h-3.5 w-3.5 text-purple-400" />
                          <span>Single Sovereign GPU</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Single Node
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Auto-routes to the highest-reputation, lowest-cost available node.
                      </p>
                    </button>
                  </div>

                  {/* Parallel Scale Selector (shown when not single) */}
                  {computeStrategy !== "single" && (
                    <div className="space-y-1.5 pt-2 border-t border-border/40">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Target Compute Scale:</span>
                        <span className="font-mono text-primary font-medium">
                          {gpuScale === "auto" ? `Auto-Scale (${Math.max(2, onlineNodes.length)} Nodes)` : `${gpuScale} Nodes`}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setGpuScale("auto")}
                          className={`px-2.5 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer text-center ${
                            gpuScale === "auto"
                              ? "border-primary bg-primary/20 text-primary font-semibold"
                              : "border-border/50 hover:bg-muted/40 text-muted-foreground"
                          }`}
                        >
                          ⚡ Auto-Scale (All Available)
                        </button>
                        <button
                          type="button"
                          onClick={() => setGpuScale("2")}
                          className={`px-2.5 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer text-center ${
                            gpuScale === "2"
                              ? "border-primary bg-primary/20 text-primary font-semibold"
                              : "border-border/50 hover:bg-muted/40 text-muted-foreground"
                          }`}
                        >
                          2 Nodes (Dual Mesh)
                        </button>
                        <button
                          type="button"
                          onClick={() => setGpuScale("4")}
                          className={`px-2.5 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer text-center ${
                            gpuScale === "4"
                              ? "border-primary bg-primary/20 text-primary font-semibold"
                              : "border-border/50 hover:bg-muted/40 text-muted-foreground"
                          }`}
                        >
                          4 Nodes (Quad Swarm)
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Decentralized Swarm Protocol Cockpit */}
                  <div className="p-2.5 rounded-md bg-background/60 border border-border/40 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between text-foreground font-medium">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                        Decentralized Swarm Consensus Protocol
                      </span>
                      <span className="font-mono text-xs text-emerald-400">PoDS v1.7 Active</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                      <div>🌐 Fleet Pool: <span className="text-foreground font-mono">{onlineNodes.length} Verified Nodes</span></div>
                      <div>💾 VRAM Headroom: <span className="text-foreground font-mono">{totalOnlineVram.toFixed(1)} GB Available</span></div>
                      <div>⚖️ Sharding: <span className="text-foreground font-mono">Dynamic Compute-Weighted</span></div>
                      <div>🛡️ Self-Healing: <span className="text-foreground font-mono">Auto-Failover Enabled</span></div>
                    </div>
                    <p className="text-[10px] text-muted-foreground/80 italic pt-0.5">
                      Workload micro-batches are automatically partitioned across decentralized worker nodes and verified via Proof-of-Delivered-Slice consensus.
                    </p>
                  </div>

                  {/* Optional Developer Override Collapsible */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowDevOverride(!showDevOverride)}
                      className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {showDevOverride ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <span>Developer Override (Manual Node Pinning)</span>
                      {devOverrideNodeId && <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">Pinned: {devOverrideNodeId}</Badge>}
                    </button>
                    {showDevOverride && (
                      <div className="mt-2 p-2 rounded border border-border/40 bg-muted/30 space-y-1.5">
                        <div className="text-[11px] text-muted-foreground">
                          Pin job to a specific worker node (leave empty for autonomous network routing):
                        </div>
                        <select
                          value={devOverrideNodeId}
                          onChange={(e) => setDevOverrideNodeId(e.target.value)}
                          className="w-full bg-background border border-border/60 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">-- Autonomous Network Selection (Recommended) --</option>
                          {clusterNodes.map((n) => (
                            <option key={n.node_id} value={n.node_id}>
                              {n.name || n.node_id} ({n.gpu_model || "CPU"} - {n.status})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="datasetUrl">Dataset S3 Location (.jsonl)</Label>
                    <button
                      type="button"
                      onClick={handleGenerateUploadUrl}
                      disabled={isGeneratingUpload}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <UploadCloud className="h-3 w-3" />
                      Auto-generate presigned upload S3 URL
                    </button>
                  </div>
                  <Input
                    id="datasetUrl"
                    value={datasetUrl}
                    onChange={(e) => setDatasetUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="epochs">Epochs</Label>
                    <Input
                      id="epochs"
                      type="number"
                      min="1"
                      max="100"
                      value={epochs}
                      onChange={(e) => setEpochs(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lr">Learning Rate</Label>
                    <Input
                      id="lr"
                      type="text"
                      value={learningRate}
                      onChange={(e) => setLearningRate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="loraR">LoRA Rank (r)</Label>
                    <Input
                      id="loraR"
                      type="number"
                      value={loraR}
                      onChange={(e) => setLoraR(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsSubmitModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Dispatching..." : "Launch Job"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Metrics Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Jobs Submitted</CardDescription>
            <CardTitle className="text-2xl font-bold">{jobs.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Running</CardDescription>
            <CardTitle className="text-2xl font-bold text-sky-500">
              {jobs.filter((j) => j.status === "running").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Successfully Completed</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-500">
              {jobs.filter((j) => j.status === "completed").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Checkpoints Preserved</CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-500">
              {jobs.reduce((acc, j) => acc + (j.checkpoints?.length || 0), 0)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Jobs Fleet Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Training Runs & Telemetry
          </CardTitle>
          <CardDescription>
            Click "Inspect Telemetry" on any job to view epoch gradient descent curves and download .safetensors adapters
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && jobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <RotateCw className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
              <p>Loading training runs...</p>
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Database className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No training jobs launched yet. Click "Launch Training Run" to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                  <tr>
                    <th className="py-3 px-4">Job Name</th>
                    <th className="py-3 px-4">Model & Type</th>
                    <th className="py-3 px-4">Epochs</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Checkpoints</th>
                    <th className="py-3 px-4">Est. Cost</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-medium">
                        <div>{job.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{job.id.slice(0, 13)}...</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold">{job.base_model}</div>
                        <div className="text-xs text-muted-foreground uppercase">{job.train_type} • {job.parallelism}</div>
                      </td>
                      <td className="py-3 px-4">
                        {job.current_epoch} / {job.total_epochs}
                      </td>
                      <td className="py-3 px-4">{getStatusBadge(job.status)}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline">{job.checkpoints?.length || 0} saved</Badge>
                      </td>
                      <td className="py-3 px-4 font-mono">${job.cost.toFixed(4)}</td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => openTelemetry(job)}>
                          Inspect Telemetry
                        </Button>
                        {["queued", "running"].includes(job.status) && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleCancelJob(job.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Telemetry & Checkpoints Modal */}
      <Dialog open={isTelemetryModalOpen} onOpenChange={setIsTelemetryModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              Training Telemetry: {selectedJob?.name}
            </DialogTitle>
            <DialogDescription>
              Job ID: <span className="font-mono">{selectedJob?.id}</span> • Status: {selectedJob && getStatusBadge(selectedJob.status)}
            </DialogDescription>
          </DialogHeader>

          {selectedJob && (
            <div className="space-y-6 mt-4">
              {/* Progress Summary */}
              <div className="p-4 rounded-lg bg-muted/40 border grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Current Epoch</div>
                  <div className="text-xl font-bold">{selectedJob.current_epoch} / {selectedJob.total_epochs}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Base Model</div>
                  <div className="text-sm font-semibold truncate">{selectedJob.base_model}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Latest Loss</div>
                  <div className="text-xl font-bold text-emerald-500 font-mono">
                    {selectedJob.loss_history?.length
                      ? selectedJob.loss_history[selectedJob.loss_history.length - 1].loss.toFixed(4)
                      : "N/A"}
                  </div>
                </div>
              </div>

              {/* Loss Descent Curve Table */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Sliders className="h-4 w-4" />
                  Epoch Loss Progression
                </h4>
                {selectedJob.loss_history?.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No gradient steps recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded border">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted font-semibold">
                        <tr>
                          <th className="py-2 px-3">Epoch</th>
                          <th className="py-2 px-3">Step</th>
                          <th className="py-2 px-3">Training Loss</th>
                          <th className="py-2 px-3">Validation Loss</th>
                          <th className="py-2 px-3">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedJob.loss_history.map((step) => (
                          <tr key={step.step} className="font-mono">
                            <td className="py-2 px-3">{step.epoch}</td>
                            <td className="py-2 px-3">{step.step}</td>
                            <td className="py-2 px-3 text-emerald-600 font-semibold">{step.loss.toFixed(4)}</td>
                            <td className="py-2 px-3 text-sky-600">{step.val_loss ? step.val_loss.toFixed(4) : "—"}</td>
                            <td className="py-2 px-3 text-muted-foreground">{new Date(step.timestamp).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Checkpoints & Download Links */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Saved LoRA Checkpoints (.safetensors)
                </h4>
                {selectedJob.checkpoints?.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No checkpoints saved yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedJob.checkpoints.map((ckpt) => (
                      <div
                        key={ckpt.epoch}
                        className="flex items-center justify-between p-3 rounded-md border bg-muted/20 text-sm"
                      >
                        <div>
                          <div className="font-medium">Epoch {ckpt.epoch} Adapter Weights</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {(ckpt.size_bytes / 1024).toFixed(1)} KB • {new Date(ckpt.created_at).toLocaleString()}
                          </div>
                        </div>
                        <a
                          href={ckpt.s3_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download Safetensors
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
