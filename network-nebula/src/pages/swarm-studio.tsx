import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Layers,
  Cpu,
  Network,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Play,
  RotateCw,
  Server,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  Sparkles,
  Plus,
  Copy,
  Check,
  Flame,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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
  swarmService,
  type SwarmPipelineInfo,
  type ShardedModelSpec,
  type KVCacheTelemetry,
  type FaultToleranceReport,
  type SwarmGenerationResult,
} from "@/services/api/swarm";
import { toast } from "sonner";

export function SwarmStudioPage() {
  // State: Pipelines & Catalog
  const [pipelines, setPipelines] = useState<SwarmPipelineInfo[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [models, setModels] = useState<ShardedModelSpec[]>([]);
  const [kvTelemetry, setKvTelemetry] = useState<KVCacheTelemetry | null>(null);
  const [faultReport, setFaultReport] = useState<FaultToleranceReport | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);


  // State: Generation & Telemetry
  const [promptText, setPromptText] = useState<string>(
    "Explain how Project Network Nebula shards 70B LLMs across consumer 8GB GPUs."
  );
  const [maxTokens, setMaxTokens] = useState<number>(12);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationResult, setGenerationResult] = useState<SwarmGenerationResult | null>(null);
  const [copiedCompletion, setCopiedCompletion] = useState<boolean>(false);

  // State: Create Pipeline Dialog
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [newModelId, setNewModelId] = useState<string>("meta-llama/Llama-3-70B");
  const [newNumStages, setNewNumStages] = useState<number>(4);
  const [newQuantization, setNewQuantization] = useState<string>("4bit");
  const [newPipelineName, setNewPipelineName] = useState<string>("");
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // State: Partition Planner
  const [plannerModelId, setPlannerModelId] = useState<string>("meta-llama/Llama-3-70B");
  const [plannerStages, setPlannerStages] = useState<number>(4);
  const [plannerQuant, setPlannerQuant] = useState<string>("4bit");
  const [plannerResult, setPlannerResult] = useState<any | null>(null);
  const [isPlanning, setIsPlanning] = useState<boolean>(false);

  // Active Pipeline helper
  const activePipeline = useMemo(() => {
    return pipelines.find((p) => p.pipeline_id === selectedPipelineId) || pipelines[0] || null;
  }, [pipelines, selectedPipelineId]);

  // Load all telemetry
  const loadData = useCallback(async (showToast = false) => {
    try {
      setIsRefreshing(true);
      const [pipeRes, modelRes, kvRes] = await Promise.all([
        swarmService.listPipelines(),
        swarmService.getSupportedModels(),
        swarmService.getKVCacheStats(),
      ]);

      const fetchedPipes = pipeRes.pipelines || [];
      setPipelines(fetchedPipes);
      setModels(modelRes.models || []);
      setKvTelemetry(kvRes.telemetry || null);

      // Select default pipeline if none selected
      if (fetchedPipes.length > 0 && !selectedPipelineId) {
        setSelectedPipelineId(fetchedPipes[0].pipeline_id);
      }

      if (showToast) {
        toast.success(`Swarm state synchronized (${fetchedPipes.length} active pipelines)`);
      }
    } catch (err) {
      console.error("Failed to load swarm studio telemetry:", err);
      if (showToast) {
        toast.error("Failed to connect to swarm sharding orchestrator");
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedPipelineId]);

  // Load fault tolerance report for active pipeline
  const loadFaultTolerance = useCallback(async (pipelineId: string) => {
    if (!pipelineId) return;
    try {
      const res = await swarmService.getFaultTolerance(pipelineId);
      setFaultReport(res.fault_tolerance);
    } catch (err) {
      console.error("Failed to load fault tolerance report:", err);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(false), 20000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (activePipeline?.pipeline_id) {
      loadFaultTolerance(activePipeline.pipeline_id);
    }
  }, [activePipeline?.pipeline_id, loadFaultTolerance]);

  // Handle Create Pipeline
  const handleCreatePipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsCreating(true);
      const res = await swarmService.createPipeline({
        model_id: newModelId,
        num_stages: newNumStages,
        quantization: newQuantization,
        name: newPipelineName.trim() || undefined,
      });

      toast.success(`Pipeline created: ${res.pipeline.pipeline_id} (${res.pipeline.stages.length} stages)`);
      setCreateDialogOpen(false);
      setNewPipelineName("");
      await loadData();
      setSelectedPipelineId(res.pipeline.pipeline_id);
    } catch (err: any) {
      console.error("Failed to create pipeline:", err);
      toast.error(err.response?.data?.detail || "Failed to create pipeline");
    } finally {
      setIsCreating(false);
    }
  };

  // Handle Manual Stage Failover
  const handleTriggerFailover = async (stageIdx: number) => {
    if (!activePipeline) return;
    try {
      const res = await swarmService.triggerFailover(
        activePipeline.pipeline_id,
        stageIdx,
        "studio_manual_operator_switch"
      );
      toast.success(
        `Stage ${stageIdx} failover complete! ${res.failover.old_primary} -> ${res.failover.new_primary}`
      );
      await loadData();
      await loadFaultTolerance(activePipeline.pipeline_id);
    } catch (err: any) {
      console.error("Failover trigger error:", err);
      toast.error(err.response?.data?.detail || `Failed to failover stage ${stageIdx}`);
    }
  };

  // Handle Swarm Inference Execution
  const handleRunInference = async (simulateDropout: boolean = false) => {
    if (!activePipeline) {
      toast.error("Please select or create an active pipeline first");
      return;
    }
    try {
      setIsGenerating(true);
      if (simulateDropout) {
        toast.info("Simulating mid-generation node crash on Stage 1 (Step 2)...");
        const res = await swarmService.simulateDropout(activePipeline.pipeline_id, {
          prompt: promptText,
          max_tokens: maxTokens,
          drop_stage_idx: 1,
          drop_at_step: 2,
        });
        setGenerationResult(res.simulation);
        if ((res.simulation.total_failovers_handled || 0) > 0) {
          toast.success(
            `Auto-healing succeeded! Standby replica promoted without token loss (${res.simulation.tokens_generated} tokens generated)`
          );
        } else {
          toast.success(`Swarm generation complete (${res.simulation.tokens_generated} tokens)`);
        }
      } else {
        const res = await swarmService.generateSwarm(activePipeline.pipeline_id, {
          prompt: promptText,
          max_tokens: maxTokens,
          temperature,
        });
        setGenerationResult(res.generation);
        toast.success(`Swarm completion received (${res.generation.tokens_generated} tokens)`);
      }
      await loadData();
      await loadFaultTolerance(activePipeline.pipeline_id);
    } catch (err: any) {
      console.error("Swarm generation failed:", err);
      toast.error(err.response?.data?.detail || "Swarm inference generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Run Dry-Run Partition Plan
  const handleComputePlan = async () => {
    try {
      setIsPlanning(true);
      const res = await swarmService.computePartitionPlan({
        model_id: plannerModelId,
        num_stages: plannerStages,
        quantization: plannerQuant,
      });
      setPlannerResult(res);
      toast.success(
        `Computed ${plannerStages}-stage partition plan (${res.total_vram_budget_gb} GB VRAM budget)`
      );
    } catch (err: any) {
      console.error("Partition planning failed:", err);
      toast.error(err.response?.data?.detail || "Partition planning calculation failed");
    } finally {
      setIsPlanning(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCompletion(true);
    setTimeout(() => setCopiedCompletion(false), 2000);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 space-y-8">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Swarm Model Sharding Studio</h1>
              <p className="text-sm text-muted-foreground">
                Decentralized Petals-style Transformer Pipeline Parallelism across consumer 8GB GPUs
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Sync Swarm
          </Button>

          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow">
                <Plus className="h-4 w-4" />
                Partition New Model
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Deploy Sharded Model Pipeline</DialogTitle>
                <DialogDescription>
                  Slice 70B+ model weights into contiguous layer blocks and bind primary + standby consumer GPU nodes.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreatePipeline} className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="model-select">Target Foundation Model</Label>
                  <select
                    id="model-select"
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {models.map((m) => (
                      <option key={m.model_id} value={m.model_id}>
                        {m.name} ({m.total_layers} Layers, {m.total_params_b}B Params)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="stages-count">Number of Pipeline Stages (Nodes)</Label>
                  <div className="flex items-center gap-4">
                    <Slider
                      id="stages-count"
                      value={newNumStages}
                      min={1}
                      max={8}
                      step={1}
                      onValueChange={(val) => setNewNumStages(val)}
                      className="flex-1"
                    />
                    <span className="font-mono text-sm font-semibold w-8 text-right">
                      {newNumStages}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ~{Math.ceil(80 / newNumStages)} layers/node (~{((40 / newNumStages) + 1.2).toFixed(1)} GB VRAM/node on 4-bit)
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="quant-select">Quantization Format</Label>
                  <select
                    id="quant-select"
                    value={newQuantization}
                    onChange={(e) => setNewQuantization(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="4bit">4-bit NF4 / AWQ (~38GB total for 70B - fits on 4x 8GB GPUs)</option>
                    <option value="8bit">8-bit Int8 (~75GB total for 70B)</option>
                    <option value="fp16">16-bit Float16 (~140GB total for 70B)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pipe-name">Friendly Name (Optional)</Label>
                  <Input
                    id="pipe-name"
                    placeholder="e.g. Swarm-Llama-70B-Production"
                    value={newPipelineName}
                    onChange={(e) => setNewPipelineName(e.target.value)}
                  />
                </div>

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCreateDialogOpen(false)}
                    disabled={isCreating}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isCreating} className="gap-2">
                    {isCreating ? <RotateCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Deploy Pipeline
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Overview Metric Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Active Pipelines */}
        <Card className="border border-border/80 bg-card/60 backdrop-blur shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Pipelines</CardTitle>
            <Network className="h-4 w-4 text-indigo-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{pipelines.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {pipelines.filter((p) => p.is_complete).length} fully assigned & ready
            </p>
          </CardContent>
        </Card>

        {/* Metric 2: Sharded Model Size */}
        <Card className="border border-border/80 bg-card/60 backdrop-blur shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Selected Sharded Model</CardTitle>
            <Cpu className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold truncate">
              {activePipeline?.model_id.split("/").pop() || "None"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {activePipeline ? `${activePipeline.total_layers} Layers • ${activePipeline.num_stages} Stages` : "No active pipeline"}
            </p>
          </CardContent>
        </Card>

        {/* Metric 3: Swarm Fault Tolerance */}
        <Card className="border border-border/80 bg-card/60 backdrop-blur shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fault Tolerance Tier</CardTitle>
            {activePipeline?.redundancy_level === "optimal" ? (
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-400" />
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold capitalize font-mono">
                {activePipeline?.redundancy_level || "none"}
              </span>
              <Badge
                variant={
                  activePipeline?.redundancy_level === "optimal"
                    ? "default"
                    : activePipeline?.redundancy_level === "degraded"
                    ? "secondary"
                    : "outline"
                }
                className="text-[10px] uppercase"
              >
                {activePipeline?.health_score || 0}% Health
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {activePipeline?.total_standbys || 0} standby replicas • {activePipeline?.total_failovers || 0} failovers
            </p>
          </CardContent>
        </Card>

        {/* Metric 4: Distributed KV-Cache */}
        <Card className="border border-border/80 bg-card/60 backdrop-blur shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Distributed KV-Cache</CardTitle>
            <Database className="h-4 w-4 text-pink-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {kvTelemetry?.total_memory_mb ? `${kvTelemetry.total_memory_mb.toFixed(1)} MB` : "0.0 MB"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {kvTelemetry?.total_tokens_cached || 0} tokens cached • {kvTelemetry?.cache_hit_rate_pct?.toFixed(0) || 100}% hit rate
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs Layout */}
      <Tabs defaultValue="topology" className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-3">
          <TabsList className="bg-muted/60 p-1">
            <TabsTrigger value="topology" className="gap-2">
              <Network className="h-4 w-4" />
              Pipeline Topology & Shards
            </TabsTrigger>
            <TabsTrigger value="inference" className="gap-2">
              <Zap className="h-4 w-4" />
              Live Swarm Inference & Waterfall
            </TabsTrigger>
            <TabsTrigger value="planner" className="gap-2">
              <Cpu className="h-4 w-4" />
              Model Partition Planner
            </TabsTrigger>
            <TabsTrigger value="kv-cache" className="gap-2">
              <Database className="h-4 w-4" />
              KV-Cache Memory Pool
            </TabsTrigger>
          </TabsList>

          {/* Active Pipeline Selector Dropdown */}
          {pipelines.length > 0 && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Label htmlFor="active-pipe-select" className="text-xs text-muted-foreground whitespace-nowrap">
                Active Pipeline:
              </Label>
              <select
                id="active-pipe-select"
                value={selectedPipelineId}
                onChange={(e) => setSelectedPipelineId(e.target.value)}
                className="h-9 px-3 rounded-md border border-input bg-card text-xs font-mono font-medium focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {pipelines.map((p) => (
                  <option key={p.pipeline_id} value={p.pipeline_id}>
                    {p.name} ({p.pipeline_id}) - {p.num_stages} Stages [{p.status}]
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* TAB 1: PIPELINE TOPOLOGY & SHARDS */}
        {/* ------------------------------------------------------------- */}
        <TabsContent value="topology" className="space-y-6">
          {activePipeline ? (
            <div className="space-y-6">
              {/* Pipeline Meta Header */}
              <Card className="border-border/80 bg-card/60 backdrop-blur">
                <CardHeader className="pb-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        <span>{activePipeline.name}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {activePipeline.pipeline_id}
                        </Badge>
                        <Badge
                          variant={activePipeline.status === "ready" ? "default" : "secondary"}
                          className="text-xs capitalize"
                        >
                          {activePipeline.status}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Model: <span className="font-semibold text-foreground">{activePipeline.model_id}</span> •{" "}
                        {activePipeline.total_layers} Transformer Layers • {activePipeline.quantization} Precision •{" "}
                        VRAM Budget: <span className="font-mono text-foreground">{activePipeline.total_vram_budget_gb} GB</span>
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => loadFaultTolerance(activePipeline.pipeline_id)}
                        className="gap-1.5 text-xs"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                        Refresh Nodes
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Interactive Node Flow Diagram */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
                    <Server className="h-4 w-4 text-primary" />
                    Distributed Stage Execution Chain (Activation Flow: Stage 0 → Stage {activePipeline.stages.length - 1})
                  </h3>
                  <span className="text-xs text-muted-foreground font-mono">
                    NEBACT01 Wire Protocol • CRC32 Verified
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 relative">
                  {activePipeline.stages.map((stage) => {
                    const isEmbeddings = stage.has_embeddings;
                    const isLMHead = stage.has_lm_head;
                    const hasStandby = stage.standby_worker_ids.length > 0;

                    return (
                      <Card
                        key={stage.stage_idx}
                        className={`relative border transition-all duration-200 ${
                          stage.status === "ready"
                            ? "border-border/80 bg-card/70 hover:border-primary/50 shadow-sm"
                            : "border-destructive/40 bg-destructive/5"
                        }`}
                      >
                        {/* Top Stage Header */}
                        <CardHeader className="p-4 pb-2">
                          <div className="flex items-center justify-between">
                            <Badge
                              variant="outline"
                              className="font-mono text-xs bg-muted/60 border-primary/20 text-primary"
                            >
                              Stage {stage.stage_idx}
                            </Badge>
                            <span className="text-xs font-mono text-muted-foreground">
                              {stage.estimated_vram_gb} GB VRAM
                            </span>
                          </div>
                          <CardTitle className="text-base font-semibold mt-1">
                            Layers {stage.start_layer} - {stage.end_layer}
                          </CardTitle>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {isEmbeddings && (
                              <Badge variant="secondary" className="text-[10px] bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                                Embeddings Table
                              </Badge>
                            )}
                            {isLMHead && (
                              <Badge variant="secondary" className="text-[10px] bg-pink-500/10 text-pink-400 border-pink-500/20">
                                LM Head / Logits
                              </Badge>
                            )}
                            {!isEmbeddings && !isLMHead && (
                              <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
                                Hidden Blocks ({stage.layer_count}L)
                              </Badge>
                            )}
                          </div>
                        </CardHeader>

                        {/* Node Assignment Content */}
                        <CardContent className="p-4 pt-2 space-y-3">
                          {/* Primary Worker */}
                          <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Primary Node</span>
                              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Active
                              </span>
                            </div>
                            <div className="font-mono text-xs font-semibold truncate text-foreground">
                              {stage.primary_worker_id || "Unassigned"}
                            </div>
                          </div>

                          {/* Standby Replicas */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Standby Replicas ({stage.standby_worker_ids.length})</span>
                              {hasStandby ? (
                                <span className="text-emerald-400 text-[10px]">Optimal</span>
                              ) : (
                                <span className="text-amber-400 text-[10px]">No Standby</span>
                              )}
                            </div>
                            {stage.standby_worker_ids.length > 0 ? (
                              <div className="space-y-1">
                                {stage.standby_worker_ids.map((swid, sIdx) => (
                                  <div
                                    key={sIdx}
                                    className="p-1.5 px-2 rounded border border-border/40 bg-muted/20 font-mono text-[11px] truncate text-muted-foreground flex items-center justify-between"
                                  >
                                    <span className="truncate">{swid}</span>
                                    <span className="text-[9px] uppercase tracking-wider text-primary font-semibold">
                                      Hot Standby
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-muted-foreground italic">
                                No standby worker assigned
                              </p>
                            )}
                          </div>

                          {/* Offline nodes / Failover history if any */}
                          {stage.failover_history.length > 0 && (
                            <div className="pt-2 border-t border-border/40 text-[11px] space-y-1">
                              <div className="flex items-center justify-between text-amber-400 font-medium">
                                <span>Failovers Handled:</span>
                                <span>{stage.failover_history.length}</span>
                              </div>
                              <p className="text-[10px] text-muted-foreground truncate">
                                Last: {stage.failover_history[stage.failover_history.length - 1].reason}
                              </p>
                            </div>
                          )}

                          {/* Action Button: Simulate Failover */}
                          <div className="pt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={stage.standby_worker_ids.length === 0}
                              onClick={() => handleTriggerFailover(stage.stage_idx)}
                              className="w-full text-xs h-8 gap-1.5 hover:border-amber-500/50 hover:text-amber-400"
                            >
                              <Flame className="h-3 w-3 text-amber-400" />
                              Promote Standby
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

              {/* Fault Tolerance & Swarm Health Card */}
              {faultReport && (
                <Card className="border-border/80 bg-card/60 backdrop-blur">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      Swarm Self-Healing & Standby Replication Health Audit
                    </CardTitle>
                    <CardDescription>
                      Continuous peer-to-peer heartbeat monitoring with automatic zero-drop failover routing
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-lg bg-muted/20 border border-border/40">
                      <div>
                        <span className="text-xs text-muted-foreground">Redundancy Status</span>
                        <div className="text-sm font-semibold capitalize text-foreground mt-0.5">
                          {faultReport.redundancy_level}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Protected Stages</span>
                        <div className="text-sm font-semibold text-foreground mt-0.5 font-mono">
                          {faultReport.stages_with_standby} / {faultReport.total_stages}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Standby Pool</span>
                        <div className="text-sm font-semibold text-foreground mt-0.5 font-mono">
                          {faultReport.total_standbys} nodes ready
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Failover Incidents</span>
                        <div className="text-sm font-semibold text-foreground mt-0.5 font-mono">
                          {faultReport.total_failovers} auto-healed
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card className="p-12 text-center border-dashed">
              <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold">No Swarm Pipelines Available</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                Create a sharded pipeline to partition 70B+ LLM layers across consumer GPUs.
              </p>
              <Button
                onClick={() => setCreateDialogOpen(true)}
                className="mt-4 gap-2"
              >
                <Plus className="h-4 w-4" />
                Partition New Model
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        {/* TAB 2: LIVE SWARM INFERENCE & WATERFALL */}
        {/* ------------------------------------------------------------- */}
        <TabsContent value="inference" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 1 Col: Inference Controls */}
            <Card className="lg:col-span-1 border-border/80 bg-card/60 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-amber-400" />
                  Swarm Inference Runner
                </CardTitle>
                <CardDescription>
                  Dispatches prompt across decentralized stage chain with KV-cache reuse.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="inference-prompt">Prompt Input</Label>
                  <textarea
                    id="inference-prompt"
                    rows={4}
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    className="w-full p-2.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Enter prompt for sharded model..."
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <Label htmlFor="tokens-slider">Tokens to Generate</Label>
                    <span className="font-mono font-semibold">{maxTokens} tokens</span>
                  </div>
                  <Slider
                    id="tokens-slider"
                    value={maxTokens}
                    min={4}
                    max={32}
                    step={2}
                    onValueChange={(val) => setMaxTokens(val)}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <Label htmlFor="temp-input">Sampling Temperature</Label>
                    <span className="font-mono font-semibold">{temperature}</span>
                  </div>
                  <Input
                    id="temp-input"
                    type="number"
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.7)}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="pt-2 space-y-2">
                  <Button
                    onClick={() => handleRunInference(false)}
                    disabled={isGenerating || !activePipeline}
                    className="w-full gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow"
                  >
                    {isGenerating ? <RotateCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Execute Sharded Forward Pass
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleRunInference(true)}
                    disabled={isGenerating || !activePipeline}
                    className="w-full gap-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  >
                    <Flame className="h-4 w-4" />
                    Simulate Node Dropout Mid-Flight
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Right 2 Cols: Live Output & Latency Waterfall */}
            <div className="lg:col-span-2 space-y-6">
              {/* Output Display Card */}
              <Card className="border-border/80 bg-card/60 backdrop-blur">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Swarm Generated Output
                    </CardTitle>
                    <CardDescription>
                      Assembled from sequential activations streamed across peer GPU nodes
                    </CardDescription>
                  </div>
                  {generationResult?.completion && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(generationResult.completion)}
                      className="gap-1.5 text-xs h-8"
                    >
                      {copiedCompletion ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedCompletion ? "Copied" : "Copy"}
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {generationResult ? (
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg bg-muted/40 border border-border/60 font-mono text-sm leading-relaxed whitespace-pre-wrap">
                        {generationResult.completion}
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-muted-foreground">
                        <span>Tokens: <strong className="text-foreground">{generationResult.tokens_generated}</strong></span>
                        <span>Total RTT: <strong className="text-foreground">{generationResult.total_latency_ms.toFixed(1)}ms</strong></span>
                        <span>Avg Decode Step: <strong className="text-emerald-400">{generationResult.avg_decode_latency_ms.toFixed(1)}ms</strong></span>
                        <span>Wire Transfer: <strong className="text-foreground">{(generationResult.total_wire_bytes / 1024).toFixed(1)} KB</strong></span>
                        {generationResult.total_failovers_handled ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {generationResult.total_failovers_handled} Failovers Handled Seamlessly
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center border border-dashed rounded-lg text-muted-foreground text-sm">
                      Run an inference request to view live sharded token output and step latency.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Latency Waterfall Breakdown */}
              {generationResult && generationResult.steps.length > 0 && (
                <Card className="border-border/80 bg-card/60 backdrop-blur">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="h-4 w-4 text-indigo-400" />
                      Token Generation Step Latency Waterfall
                    </CardTitle>
                    <CardDescription>
                      Prefill (Step 0) vs Decode (Steps 1..N) accelerated by stage KV-cache reuse
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {generationResult.steps.map((st) => {
                        const maxStepLat = Math.max(...generationResult.steps.map((s) => s.latency_ms), 50);
                        const pct = Math.min(100, Math.max(8, (st.latency_ms / maxStepLat) * 100));

                        return (
                          <div
                            key={st.step}
                            className="flex items-center gap-3 p-2 rounded border border-border/30 bg-muted/20 text-xs font-mono"
                          >
                            <span className="w-14 text-muted-foreground">
                              {st.is_decode ? `Step ${st.step}` : "Prefill"}
                            </span>
                            <span className="w-24 truncate font-semibold text-foreground">
                              "{st.token.trim() || st.token}"
                            </span>
                            <div className="flex-1 bg-muted/60 h-2.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  !st.is_decode
                                    ? "bg-indigo-500"
                                    : st.latency_ms < 150
                                    ? "bg-emerald-500"
                                    : "bg-amber-500"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-16 text-right font-medium text-foreground">
                              {st.latency_ms.toFixed(1)}ms
                            </span>
                            <span className="w-16 text-right text-[11px] text-muted-foreground">
                              {st.hops} hops
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        {/* TAB 3: MODEL PARTITION PLANNER */}
        {/* ------------------------------------------------------------- */}
        <TabsContent value="planner" className="space-y-6">
          <Card className="border-border/80 bg-card/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Cpu className="h-5 w-5 text-purple-400" />
                Consumer GPU Sharding Partition Planner
              </CardTitle>
              <CardDescription>
                Simulate contiguous layer block distribution and per-node VRAM ceilings before deploying to the swarm.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Foundation Model</Label>
                  <select
                    value={plannerModelId}
                    onChange={(e) => setPlannerModelId(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {models.map((m) => (
                      <option key={m.model_id} value={m.model_id}>
                        {m.name} ({m.total_layers}L)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Stage Slices (Nodes)</Label>
                  <select
                    value={plannerStages}
                    onChange={(e) => setPlannerStages(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value={2}>2 Stages (Large 16GB GPUs)</option>
                    <option value={4}>4 Stages (Consumer 8GB GPUs - Standard)</option>
                    <option value={8}>8 Stages (Budget 6GB-8GB GPUs)</option>
                    <option value={16}>16 Stages (Ultra-Granular Swarm)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Quantization</Label>
                  <select
                    value={plannerQuant}
                    onChange={(e) => setPlannerQuant(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="4bit">4-bit AWQ / NF4</option>
                    <option value="8bit">8-bit Int8</option>
                    <option value="fp16">16-bit Float16</option>
                  </select>
                </div>
              </div>

              <Button
                onClick={handleComputePlan}
                disabled={isPlanning}
                className="gap-2"
              >
                {isPlanning ? <RotateCw className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                Calculate Dry-Run Partition Plan
              </Button>

              {plannerResult && (
                <div className="space-y-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">
                      Partition Topology ({plannerResult.num_stages} Stages • Total VRAM Budget: {plannerResult.total_vram_budget_gb} GB)
                    </h4>
                    <Badge variant="outline" className="text-xs">
                      Max Node VRAM: ~{(plannerResult.total_vram_budget_gb / plannerResult.num_stages).toFixed(1)} GB
                    </Badge>
                  </div>

                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left">Stage</th>
                          <th className="p-3 text-left">Layer Range</th>
                          <th className="p-3 text-left">Blocks</th>
                          <th className="p-3 text-left">Role</th>
                          <th className="p-3 text-right">Est. VRAM Footprint</th>
                          <th className="p-3 text-center">Consumer 8GB Compatible</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60 font-mono text-xs">
                        {plannerResult.stages.map((st: any) => (
                          <tr key={st.stage_idx} className="hover:bg-muted/20">
                            <td className="p-3 font-semibold text-primary">Stage {st.stage_idx}</td>
                            <td className="p-3">{st.start_layer} - {st.end_layer}</td>
                            <td className="p-3">{st.layer_count} layers</td>
                            <td className="p-3 font-sans">
                              {st.has_embeddings ? (
                                <Badge variant="outline" className="text-[10px] text-indigo-400">Embeddings + Blocks</Badge>
                              ) : st.has_lm_head ? (
                                <Badge variant="outline" className="text-[10px] text-pink-400">Blocks + LM Head</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">Transformer Blocks</Badge>
                              )}
                            </td>
                            <td className="p-3 text-right font-semibold">{st.estimated_vram_gb} GB</td>
                            <td className="p-3 text-center">
                              {st.estimated_vram_gb <= 8.0 ? (
                                <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  100% Fit (RTX 3070/4060)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-400 text-[11px]">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  Needs 12GB+ GPU
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------- */}
        {/* TAB 4: KV-CACHE MEMORY POOL */}
        {/* ------------------------------------------------------------- */}
        <TabsContent value="kv-cache" className="space-y-6">
          <Card className="border-border/80 bg-card/60 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="h-5 w-5 text-pink-400" />
                Distributed Attention KV-Cache Diagnostics
              </CardTitle>
              <CardDescription>
                Tracks bounded per-stage key/value attention memory slices, session TTL, and LRU evictions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {kvTelemetry ? (
                <div className="space-y-6">
                  {/* Gauge Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg bg-muted/20 border border-border/40">
                      <span className="text-xs text-muted-foreground">Memory Allocated</span>
                      <div className="text-xl font-bold font-mono mt-1 text-foreground">
                        {kvTelemetry.total_memory_mb.toFixed(1)} / {kvTelemetry.max_memory_mb} MB
                      </div>
                      <div className="w-full bg-muted/60 h-2 rounded-full overflow-hidden mt-2">
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{ width: `${Math.min(100, kvTelemetry.memory_utilization_pct)}%` }}
                        />
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-muted/20 border border-border/40">
                      <span className="text-xs text-muted-foreground">Cache Hit Rate</span>
                      <div className="text-xl font-bold font-mono mt-1 text-emerald-400">
                        {kvTelemetry.cache_hit_rate_pct.toFixed(1)}%
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        {kvTelemetry.total_hits} hits • {kvTelemetry.total_misses} misses
                      </p>
                    </div>

                    <div className="p-4 rounded-lg bg-muted/20 border border-border/40">
                      <span className="text-xs text-muted-foreground">Active Sessions</span>
                      <div className="text-xl font-bold font-mono mt-1 text-foreground">
                        {kvTelemetry.active_sessions}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        TTL: {kvTelemetry.ttl_seconds}s auto-expire
                      </p>
                    </div>

                    <div className="p-4 rounded-lg bg-muted/20 border border-border/40">
                      <span className="text-xs text-muted-foreground">LRU Evictions</span>
                      <div className="text-xl font-bold font-mono mt-1 text-foreground">
                        {kvTelemetry.eviction_count}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Memory ceiling strictly enforced
                      </p>
                    </div>
                  </div>

                  {/* Cache info note */}
                  <div className="p-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-indigo-400" />
                      Zero-Loss Standby Hot-Cloning Protocol
                    </p>
                    <p>
                      When a pipeline stage worker drops or fails over, its attention key/value slices are deep-copied into the promoted standby node memory pool via <code className="text-primary font-mono">sync_stage_kv</code>, enabling instantaneous decode continuation without reprocessing the prompt.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Connecting to KV-cache memory manager...
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
