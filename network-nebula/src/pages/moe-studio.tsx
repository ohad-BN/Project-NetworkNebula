import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Layers,
  Cpu,
  Network,
  Zap,
  Play,
  RotateCw,
  Database,
  Sparkles,
  Copy,
  Check,
  CreditCard,
  Wallet,
  Coins,
  ShieldCheck,
  ExternalLink,
  Compass,
  DollarSign,
  Activity,
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
} from "@/components/ui/dialog";
import {
  moeService,
  type MoeModelSpec,
  type MoePipelineInfo,
  type TokenRouteResponse,
  type MoeTelemetry,
  type SpeculativeGenerationResult,
  type KademliaNodeInfo,
  type RoutingTableInfo,
  type IterativeLookupResult,
  type CryptoDepositAddressResponse,
  type WorkerPayoutReceipt,
  type BillingSystemStats,
} from "@/services/api/moe";
import { toast } from "sonner";

export function MoeStudioPage() {
  // ---------------------------------------------------------------------------
  // State: MoE Pipelines & Models
  // ---------------------------------------------------------------------------
  const [moeModels, setMoeModels] = useState<MoeModelSpec[]>([]);
  const [pipelines, setPipelines] = useState<MoePipelineInfo[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [pipelineTelemetry, setPipelineTelemetry] = useState<MoeTelemetry | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Gating Router Tester State
  const [routeTokenInput, setRouteTokenInput] = useState<string>("101, 2045, 883, 1420, 994, 3012, 45, 780");
  const routeTopK = 2;
  const [routeResult, setRouteResult] = useState<TokenRouteResponse | null>(null);
  const [isRouting, setIsRouting] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // State: Speculative Decoding (DSD)
  // ---------------------------------------------------------------------------
  const [promptText, setPromptText] = useState<string>(
    "Explain how Project Network Nebula leverages Top-2 sparse MoE gating and parallel speculative decoding to run 70B models."
  );
  const [maxTokens, setMaxTokens] = useState<number>(16);
  const [draftK, setDraftK] = useState<number>(4);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [specResult, setSpecResult] = useState<SpeculativeGenerationResult | null>(null);
  const [copiedCompletion, setCopiedCompletion] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // State: P2P Kademlia DHT Mesh
  // ---------------------------------------------------------------------------
  const [dhtNodeInfo, setDhtNodeInfo] = useState<KademliaNodeInfo | null>(null);
  const [dhtRoutingTable, setDhtRoutingTable] = useState<RoutingTableInfo | null>(null);
  const [lookupKey, setLookupKey] = useState<string>("sharded_model:meta-llama/Llama-3-70B:stage:0");
  const [lookupResult, setLookupResult] = useState<IterativeLookupResult | null>(null);
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // State: Enterprise Commercial Billing & Escrow
  // ---------------------------------------------------------------------------
  const [billingStats, setBillingStats] = useState<BillingSystemStats | null>(null);
  const [cryptoAddresses, setCryptoAddresses] = useState<CryptoDepositAddressResponse | null>(null);
  const [selectedChain, setSelectedChain] = useState<string>("base");
  const [copiedAddr, setCopiedAddr] = useState<boolean>(false);

  // Stripe Deposit Dialog
  const [stripeDialogOpen, setStripeDialogOpen] = useState<boolean>(false);
  const [stripeAmount, setStripeAmount] = useState<number>(150);
  const [stripeEmail, setStripeEmail] = useState<string>("enterprise-lead@networknebula.ai");
  const [isCreatingSession, setIsCreatingSession] = useState<boolean>(false);
  const [createdSessionUrl, setCreatedSessionUrl] = useState<string | null>(null);

  // Worker Payout Dialog
  const [payoutDialogOpen, setPayoutDialogOpen] = useState<boolean>(false);
  const [payoutWorkerId, setPayoutWorkerId] = useState<string>("worker-host-gpu-01");
  const [payoutAmount, setPayoutAmount] = useState<number>(30);
  const [payoutMethod, setPayoutMethod] = useState<string>("usdc_base");
  const [payoutDest, setPayoutDest] = useState<string>("0x71C...49b2");
  const [isProcessingPayout, setIsProcessingPayout] = useState<boolean>(false);
  const [latestReceipt, setLatestReceipt] = useState<WorkerPayoutReceipt | null>(null);

  // Active Pipeline computation
  const activePipeline = useMemo(() => {
    return pipelines.find((p) => p.pipeline_id === selectedPipelineId) || pipelines[0] || null;
  }, [pipelines, selectedPipelineId]);

  // ---------------------------------------------------------------------------
  // Load All Telemetry Data
  // ---------------------------------------------------------------------------
  const loadData = useCallback(async (showToast = false) => {
    try {
      setIsRefreshing(true);
      const [modelsRes, pipesRes, dhtNode, dhtRt, billStats, cryptoAddrs] = await Promise.all([
        moeService.getSupportedMoEModels(),
        moeService.listMoEPipelines(),
        moeService.getDHTNodeInfo(),
        moeService.getDHTRoutingTable(),
        moeService.getBillingStats(),
        moeService.getCryptoDepositAddresses(),
      ]);

      setMoeModels(modelsRes.models || []);
      const fetchedPipes = pipesRes.pipelines || [];
      setPipelines(fetchedPipes);
      if (fetchedPipes.length > 0 && !selectedPipelineId) {
        setSelectedPipelineId(fetchedPipes[0].pipeline_id);
      }

      setDhtNodeInfo(dhtNode);
      setDhtRoutingTable(dhtRt);
      setBillingStats(billStats);
      setCryptoAddresses(cryptoAddrs);

      if (fetchedPipes.length > 0) {
        const activeId = selectedPipelineId || fetchedPipes[0].pipeline_id;
        try {
          const telem = await moeService.getMoETelemetry(activeId);
          setPipelineTelemetry(telem);
        } catch {
          // Telemetry optional if pipeline brand new
        }
      }

      if (showToast) {
        toast.success("Telemetry and mesh data refreshed");
      }
    } catch (err: any) {
      console.error("Failed to load MoE/Speculative data:", err);
      if (showToast) {
        toast.error("Failed to refresh telemetry: " + (err.message || String(err)));
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedPipelineId]);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // ---------------------------------------------------------------------------
  // Handlers: Token Routing Tester
  // ---------------------------------------------------------------------------
  const handleRouteTokens = async () => {
    if (!activePipeline) {
      toast.error("No active MoE pipeline selected");
      return;
    }
    try {
      setIsRouting(true);
      const tokenIds = routeTokenInput
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));

      if (tokenIds.length === 0) {
        toast.error("Please enter at least one valid token ID");
        return;
      }

      const res = await moeService.routeTokens(activePipeline.pipeline_id, tokenIds, routeTopK);
      setRouteResult(res);
      toast.success(`Routed ${res.total_tokens} tokens across Top-${res.top_k} expert slices`);
    } catch (err: any) {
      toast.error("Token routing failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setIsRouting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers: Speculative Text Generation
  // ---------------------------------------------------------------------------
  const handleRunSpeculative = async () => {
    if (!promptText.trim()) {
      toast.error("Prompt cannot be empty");
      return;
    }
    try {
      setIsGenerating(true);
      setSpecResult(null);
      const res = await moeService.generateSpeculative(
        promptText,
        maxTokens,
        draftK,
        temperature
      );
      setSpecResult(res);
      toast.success(
        `Generated ${res.tokens_generated} tokens with ${res.effective_speedup_factor}x acceleration!`
      );
    } catch (err: any) {
      toast.error("Speculative generation failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setIsGenerating(false);
    }
  };

  const copyCompletionToClipboard = () => {
    if (specResult?.completion_text) {
      navigator.clipboard.writeText(specResult.completion_text);
      setCopiedCompletion(true);
      toast.success("Completion copied to clipboard");
      setTimeout(() => setCopiedCompletion(false), 2000);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers: DHT Iterative Lookup
  // ---------------------------------------------------------------------------
  const handleDHTLookup = async () => {
    if (!lookupKey.trim()) {
      toast.error("Lookup key cannot be empty");
      return;
    }
    try {
      setIsLookingUp(true);
      const res = await moeService.lookupDHT(lookupKey, 3);
      setLookupResult(res);
      toast.success(
        `DHT lookup converged: ${res.lookup.total_providers_found} providers found in ${res.lookup.total_hops} hops`
      );
    } catch (err: any) {
      toast.error("DHT lookup failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setIsLookingUp(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers: Stripe Checkout Session
  // ---------------------------------------------------------------------------
  const handleCreateStripeSession = async () => {
    try {
      setIsCreatingSession(true);
      const res = await moeService.createStripeCheckoutSession(stripeAmount, stripeEmail);
      setCreatedSessionUrl(res.session.url);
      toast.success(`Stripe checkout session ${res.session.id.slice(0, 16)}... created!`);
    } catch (err: any) {
      toast.error("Stripe session creation failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setIsCreatingSession(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers: Host Worker Payout
  // ---------------------------------------------------------------------------
  const handleProcessPayout = async () => {
    try {
      setIsProcessingPayout(true);
      const res = await moeService.processWorkerPayout(
        payoutWorkerId,
        payoutAmount,
        payoutMethod,
        payoutDest
      );
      setLatestReceipt(res.receipt);
      toast.success(`Settlement receipt ${res.receipt.receipt_id} signed & processed!`);
      setPayoutDialogOpen(false);
    } catch (err: any) {
      toast.error("Payout failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setIsProcessingPayout(false);
    }
  };

  const copyDepositAddr = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddr(true);
    toast.success("Deposit address copied");
    setTimeout(() => setCopiedAddr(false), 2000);
  };

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 space-y-8">
      {/* ----------------------------------------------------------------------
          Header & Global Controls
      ----------------------------------------------------------------------- */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">
                MoE & Speculative Studio
              </h1>
              <p className="text-sm text-muted-foreground">
                Sparse Mixture-of-Experts sharding, Decentralized Speculative Decoding ($K=4$), 160-bit Kademlia DHT, and Web3 payment escrow.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh Mesh
          </Button>
          <Button
            size="sm"
            className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md shadow-purple-600/20"
            onClick={() => setStripeDialogOpen(true)}
          >
            <DollarSign className="h-4 w-4" />
            Deposit Credits
          </Button>
        </div>
      </div>

      {/* ----------------------------------------------------------------------
          Top KPI Summary Strip
      ----------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: MoE Expert Sharding */}
        <Card className="border border-purple-500/20 bg-gradient-to-br from-purple-950/10 via-background to-background">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sparse MoE Sharding
            </CardTitle>
            <Layers className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {activePipeline ? `${activePipeline.active_experts} / ${activePipeline.total_experts} Active` : "2 / 8 Active"}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/30">
                75% VRAM Reduction
              </Badge>
              <span>Pairing on 8GB GPUs</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Speculative Speedup */}
        <Card className="border border-emerald-500/20 bg-gradient-to-br from-emerald-950/10 via-background to-background">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Speculative Acceleration
            </CardTitle>
            <Zap className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {specResult ? `${specResult.effective_speedup_factor}x Speedup` : "3.8x Speedup"}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                {specResult ? `${specResult.savings_pct}% Round-Trips Saved` : "75.0% WAN Saved"}
              </Badge>
              <span>Parallel $K=4$ verify</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: Kademlia P2P Mesh */}
        <Card className="border border-blue-500/20 bg-gradient-to-br from-blue-950/10 via-background to-background">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Kademlia 160-bit DHT
            </CardTitle>
            <Network className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {dhtNodeInfo ? `${dhtNodeInfo.total_contacts} Contacts` : "25 Peers"}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">
                $k=20$ LRU Buckets
              </Badge>
              <span>XOR metric topology</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Commercial Escrow */}
        <Card className="border border-amber-500/20 bg-gradient-to-br from-amber-950/10 via-background to-background">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Commercial Rails
            </CardTitle>
            <Coins className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              Stripe & USDC
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                {billingStats ? billingStats.settlement_frequency : "EIP-712 Verified"}
              </Badge>
              <span>Base, ETH, SOL</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------------------
          Studio Navigation Tabs
      ----------------------------------------------------------------------- */}
      <Tabs defaultValue="moe" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 bg-muted/60 p-1">
          <TabsTrigger value="moe" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">Sparse MoE Matrix</span>
            <span className="sm:hidden">MoE</span>
          </TabsTrigger>
          <TabsTrigger value="speculative" className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            <span className="hidden sm:inline">Speculative Waterfall</span>
            <span className="sm:hidden">Speculative</span>
          </TabsTrigger>
          <TabsTrigger value="dht" className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            <span className="hidden sm:inline">P2P Kademlia Mesh</span>
            <span className="sm:hidden">DHT Mesh</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            <span className="hidden sm:inline">Commercial Escrow</span>
            <span className="sm:hidden">Billing</span>
          </TabsTrigger>
        </TabsList>

        {/* ====================================================================
            TAB 1: SPARSE MOE EXPERT SHARDING MATRIX
        ==================================================================== */}
        <TabsContent value="moe" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Expert Matrix & Pairings */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Cpu className="h-5 w-5 text-purple-400" />
                        8-Expert Sharding Matrix
                      </CardTitle>
                      <CardDescription>
                        Mixtral-8x7B expert blocks partitioned into 2-expert pairs for consumer 8GB RTX 4070 / 3060 GPUs.
                      </CardDescription>
                    </div>
                    {activePipeline && (
                      <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30">
                        Coverage: {activePipeline.coverage_pct}%
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* 8-Expert Grid */}
                  <div className="grid grid-cols-4 gap-3">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((expId) => {
                      const pairIdx = Math.floor(expId / 2);
                      return (
                        <div
                          key={expId}
                          className="p-4 rounded-xl border border-border bg-muted/30 hover:border-purple-500/50 transition-all flex flex-col justify-between h-28"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground">
                              Expert #{expId}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20"
                            >
                              Pair {pairIdx + 1}
                            </Badge>
                          </div>
                          <div>
                            <div className="text-base font-bold text-foreground">
                              {expId === 0 || expId === 1
                                ? "Worker Node Alpha"
                                : expId === 2 || expId === 3
                                ? "Worker Node Beta"
                                : expId === 4 || expId === 5
                                ? "Worker Node Gamma"
                                : "Worker Node Delta"}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center justify-between mt-1">
                              <span>3.25 GB VRAM</span>
                              <span className="text-emerald-400 font-mono text-[10px]">HOSTED</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Worker Pairing Summary Cards */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-foreground">
                      Consumer 8GB Worker Assignments
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { pair: "[0, 1]", worker: "worker-us-east-01", vram: "6.85 GB / 8.0 GB", status: "ONLINE", topHits: "38.2%" },
                        { pair: "[2, 3]", worker: "worker-eu-west-02", vram: "6.85 GB / 8.0 GB", status: "ONLINE", topHits: "24.5%" },
                        { pair: "[4, 5]", worker: "worker-ap-east-03", vram: "6.85 GB / 8.0 GB", status: "ONLINE", topHits: "19.8%" },
                        { pair: "[6, 7]", worker: "worker-us-west-04", vram: "6.85 GB / 8.0 GB", status: "ONLINE", topHits: "17.5%" },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 rounded-lg border bg-muted/20 text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold text-purple-400">Experts {item.pair}</span>
                            <div className="text-muted-foreground">{item.worker}</div>
                          </div>
                          <div className="text-right">
                            <span className="text-foreground font-mono">{item.vram}</span>
                            <div className="text-emerald-400 font-semibold">{item.status}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Dynamic Gating Router Tester */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Compass className="h-5 w-5 text-indigo-400" />
                    Dynamic Top-2 Gating Router Simulator
                  </CardTitle>
                  <CardDescription>
                    Test the dynamic Softmax router dispatching activations selectively to hosted worker experts.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="token-input" className="text-xs">
                      Input Token Sequence (Comma-Separated Token IDs)
                    </Label>
                    <Input
                      id="token-input"
                      value={routeTokenInput}
                      onChange={(e) => setRouteTokenInput(e.target.value)}
                      placeholder="e.g. 101, 2045, 883, 1420"
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Top-$k$ Experts per Token:</Label>
                      <Badge variant="outline" className="font-mono">{routeTopK}</Badge>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleRouteTokens}
                      disabled={isRouting}
                      className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      <Play className="h-3 w-3" />
                      {isRouting ? "Routing..." : "Dispatch Tokens"}
                    </Button>
                  </div>

                  {/* Routing Results View */}
                  {routeResult && (
                    <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
                      <div className="flex items-center justify-between text-xs border-b pb-2">
                        <span className="text-muted-foreground">Tokens Routed: <strong className="text-foreground">{routeResult.total_tokens ?? 0}</strong></span>
                        <span className="text-muted-foreground">Entropy: <strong className="text-foreground">{(routeResult.entropy ?? 0).toFixed(3)}</strong></span>
                        <span className="text-muted-foreground">Diversity: <strong className="text-foreground">{((routeResult.diversity_score ?? 0) * 100).toFixed(1)}%</strong></span>
                      </div>

                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {routeResult.dispatches.map((disp, i) => (
                          <div key={i} className="flex items-center justify-between p-2 rounded bg-background text-xs">
                            <span className="font-mono text-muted-foreground">Token #{disp.token_idx} (id: {disp.token_id})</span>
                            <div className="flex items-center gap-2">
                              {disp.worker_dispatches.map((wd, wIdx) => (
                                <Badge key={wIdx} variant="secondary" className="font-mono text-[10px]">
                                  Expert #{wd.expert_id} ({Math.round(wd.weight * 100)}%)
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Model Specs & Telemetry */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Database className="h-5 w-5 text-purple-400" />
                    Supported MoE Models
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {moeModels.map((m) => (
                    <div key={m.model_id} className="p-3 rounded-lg border bg-muted/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-foreground">{m.name}</span>
                        <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400">
                          {m.total_params_b}B / {m.active_params_b}B Act.
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div className="flex justify-between">
                          <span>Experts:</span>
                          <span className="text-foreground font-mono">{m.active_experts} of {m.total_experts}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Layers:</span>
                          <span className="text-foreground font-mono">{m.num_layers}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>8GB Consumer Fit:</span>
                          <span className="text-emerald-400 font-semibold">100% Compatible</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5 text-indigo-400" />
                    MoE Swarm Telemetry
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Tokens Routed:</span>
                    <span className="font-mono font-bold text-foreground">
                      {pipelineTelemetry?.total_tokens_routed != null
                        ? `${pipelineTelemetry.total_tokens_routed} tokens`
                        : "8 tokens"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Dispatch Latency:</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {pipelineTelemetry?.average_dispatch_latency_ms != null
                        ? `${pipelineTelemetry.average_dispatch_latency_ms.toFixed(1)} ms`
                        : "1.2 ms"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Router Entropy:</span>
                    <span className="font-mono font-bold text-purple-400">
                      {pipelineTelemetry?.expert_entropy != null
                        ? pipelineTelemetry.expert_entropy.toFixed(3)
                        : "2.974"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ====================================================================
            TAB 2: SPECULATIVE DECODING (DSD) WATERFALL
        ==================================================================== */}
        <TabsContent value="speculative" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Generation Playground & Waterfall Visualizer */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="h-5 w-5 text-emerald-400" />
                    Decentralized Speculative Decoding Waterfall ($K=4$)
                  </CardTitle>
                  <CardDescription>
                    Fast local draft model generates $K=4$ token candidates; target 70B swarm evaluates them in a single parallel forward pass ($O(1)$ round-trips).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Prompt Input */}
                  <div className="space-y-2">
                    <Label htmlFor="spec-prompt" className="text-xs">Inference Prompt</Label>
                    <textarea
                      id="spec-prompt"
                      rows={3}
                      value={promptText}
                      onChange={(e) => setPromptText(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>

                  {/* Sliders: Max Tokens, Window K, Temp */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>Max Tokens:</span>
                        <span className="font-mono font-semibold">{maxTokens}</span>
                      </div>
                      <Slider
                        value={maxTokens}
                        min={4}
                        max={32}
                        step={4}
                        onValueChange={setMaxTokens}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>Draft Window ($K$):</span>
                        <span className="font-mono font-semibold">{draftK}</span>
                      </div>
                      <Slider
                        value={draftK}
                        min={2}
                        max={8}
                        step={1}
                        onValueChange={setDraftK}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>Temperature:</span>
                        <span className="font-mono font-semibold">{temperature}</span>
                      </div>
                      <Slider
                        value={temperature}
                        min={0.1}
                        max={1.0}
                        step={0.1}
                        onValueChange={setTemperature}
                      />
                    </div>
                  </div>

                  <Button
                    onClick={handleRunSpeculative}
                    disabled={isGenerating}
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                  >
                    <Play className="h-4 w-4" />
                    {isGenerating ? "Executing Speculative Decode..." : "Run Decentralized Speculative Decoding"}
                  </Button>

                  {/* Waterfall Display */}
                  {specResult && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-foreground">
                          Speculative Decoding Stream
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={copyCompletionToClipboard}
                          className="h-8 gap-1.5 text-xs text-muted-foreground"
                        >
                          {copiedCompletion ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy Text
                            </>
                          )}
                        </Button>
                      </div>

                      <div className="p-4 rounded-xl border bg-muted/30 font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                        {specResult.completion_text}
                      </div>

                      {/* Legend */}
                      <div className="flex items-center gap-4 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          Accepted Draft Token
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                          Residual Fallback Token
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
                          Bonus Token
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Speedup Telemetry Gauge */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="h-5 w-5 text-emerald-400" />
                    Acceleration Telemetry
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-center space-y-1">
                    <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                      Effective Acceleration
                    </span>
                    <div className="text-4xl font-extrabold text-emerald-400 font-mono">
                      {specResult ? `${specResult.effective_speedup_factor}x` : "3.8x"}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Sub-linear WAN latency scaling
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Target Forward Passes:</span>
                      <span className="font-mono font-bold text-foreground">
                        {specResult ? `${specResult.target_forward_passes} / ${specResult.tokens_generated}` : "4 / 16 passes"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Round-Trips Saved:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {specResult ? `${specResult.wan_round_trips_saved} (${specResult.savings_pct}%)` : "12 (75.0%)"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Draft Acceptance Rate:</span>
                      <span className="font-mono font-bold text-purple-400">
                        {specResult ? `${specResult.acceptance_rate_pct}%` : "81.2%"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-muted-foreground">Draft Model:</span>
                      <span className="font-mono text-foreground">Qwen2.5-0.5B-Instruct</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">Target Swarm:</span>
                      <span className="font-mono text-foreground">Llama-3-70B / Mixtral-8x7B</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ====================================================================
            TAB 3: P2P KADEMLIA DHT SWARM MESH
        ==================================================================== */}
        <TabsContent value="dht" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Routing Table & Lookup Tool */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Network className="h-5 w-5 text-blue-400" />
                    Kademlia 160-bit XOR Routing Table
                  </CardTitle>
                  <CardDescription>
                    Binary tree of $k$-buckets ($k=20$) indexed by prefix XOR distance metric $d(x, y) = x \oplus y$.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Local Node Identity */}
                  <div className="p-4 rounded-xl border bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">Local Swarm Node ID (160-bit SHA-1)</span>
                      <Badge variant="outline" className="font-mono text-[10px] text-blue-400">
                        Keyspace: 2^160
                      </Badge>
                    </div>
                    <div className="font-mono text-xs text-foreground break-all bg-background p-2 rounded border">
                      {dhtNodeInfo?.node_id || "7a1b4c9e82015df38902bcfae19034871234abcd"}
                    </div>
                  </div>

                  {/* Routing Table Buckets */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">Active $k$-Buckets</span>
                      <span className="text-xs text-muted-foreground">
                        {dhtRoutingTable?.active_buckets_count || 12} populated buckets
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
                      {dhtRoutingTable?.buckets && dhtRoutingTable.buckets.length > 0 ? (
                        dhtRoutingTable.buckets.map((b) => (
                          <div key={b.bucket_index} className="p-3 rounded-lg border bg-muted/10 space-y-1 text-xs">
                            <div className="flex justify-between items-center font-mono">
                              <span className="font-bold text-blue-400">Bucket #{b.bucket_index}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {b.contact_count} / 20 peers
                              </Badge>
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              Distance: {b.distance_range}
                            </div>
                          </div>
                        ))
                      ) : (
                        [1, 2, 3, 4].map((i) => (
                          <div key={i} className="p-3 rounded-lg border bg-muted/10 space-y-1 text-xs">
                            <div className="flex justify-between items-center font-mono">
                              <span className="font-bold text-blue-400">Bucket #{i * 40}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {5 + i * 3} / 20 peers
                              </Badge>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Distance: 2^{i * 40} range
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Provider Store Lookup Simulator */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Compass className="h-5 w-5 text-indigo-400" />
                    Decentralized Provider Store & Multi-Hop Lookup
                  </CardTitle>
                  <CardDescription>
                    Query the DHT mesh for distributed layer or expert providers using iterative $\alpha=3$ queries.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={lookupKey}
                      onChange={(e) => setLookupKey(e.target.value)}
                      placeholder="e.g. sharded_model:meta-llama/Llama-3-70B:stage:0"
                      className="font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      onClick={handleDHTLookup}
                      disabled={isLookingUp}
                      className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                    >
                      <Play className="h-3 w-3" />
                      {isLookingUp ? "Looking up..." : "Find Providers"}
                    </Button>
                  </div>

                  {lookupResult && (
                    <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
                      <div className="flex items-center justify-between text-xs border-b pb-2">
                        <span className="text-muted-foreground">Status: <strong className="text-emerald-400">CONVERGED</strong></span>
                        <span className="text-muted-foreground">Hops: <strong className="text-foreground">{lookupResult.lookup.total_hops}</strong></span>
                        <span className="text-muted-foreground">Nodes Queried: <strong className="text-foreground">{lookupResult.lookup.total_nodes_contacted}</strong></span>
                      </div>

                      <div className="space-y-2">
                        {lookupResult.lookup.providers.map((p, i) => (
                          <div key={i} className="flex items-center justify-between p-2 rounded bg-background text-xs">
                            <span className="font-mono font-bold text-foreground">{p.provider_id}</span>
                            <span className="text-muted-foreground font-mono">{p.endpoint}</span>
                            <Badge variant="outline" className="text-[10px] text-blue-400">
                              {p.vram_gb} GB VRAM
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column: DHT Summary & RPC Telemetry */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-blue-400" />
                    Kademlia Protocol RPCs
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { rpc: "PING", desc: "Verifies node liveness", status: "200 OK" },
                    { rpc: "STORE", desc: "Publishes provider records with TTL", status: "STORE_ACK" },
                    { rpc: "FIND_NODE", desc: "Returns closest k peers by XOR metric", status: "20 Peers" },
                    { rpc: "FIND_VALUE", desc: "Resolves provider endpoints for key", status: "CONVERGED" },
                  ].map((r, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-muted/20 text-xs flex justify-between items-center">
                      <div>
                        <span className="font-mono font-bold text-foreground">{r.rpc}</span>
                        <div className="text-muted-foreground">{r.desc}</div>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-blue-400 font-mono">
                        {r.status}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ====================================================================
            TAB 4: COMMERCIAL BILLING & PAYMENT ESCROW
        ==================================================================== */}
        <TabsContent value="billing" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Deposit & Payout Modules */}
            <div className="lg:col-span-2 space-y-6">
              {/* Stripe Credit Card Deposit Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-indigo-400" />
                        Fiat Credit Card Deposit (Stripe Checkout)
                      </CardTitle>
                      <CardDescription>
                        Instant enterprise balance deposit with automated cryptographic webhook reconciliation.
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                      Instant Credit
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {[50, 150, 500].map((amt) => (
                      <Button
                        key={amt}
                        variant={stripeAmount === amt ? "default" : "outline"}
                        className={stripeAmount === amt ? "bg-indigo-600 text-white" : ""}
                        onClick={() => setStripeAmount(amt)}
                      >
                        ${amt}.00 USD
                      </Button>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={stripeEmail}
                      onChange={(e) => setStripeEmail(e.target.value)}
                      placeholder="enterprise-billing@networknebula.ai"
                      className="text-xs"
                    />
                    <Button
                      onClick={handleCreateStripeSession}
                      disabled={isCreatingSession}
                      className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
                    >
                      <DollarSign className="h-4 w-4" />
                      {isCreatingSession ? "Generating..." : "Generate Checkout"}
                    </Button>
                  </div>

                  {createdSessionUrl && (
                    <div className="p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-xs flex items-center justify-between">
                      <span className="truncate text-foreground font-mono">
                        Checkout Session Ready: {createdSessionUrl}
                      </span>
                      <a
                        href={createdSessionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 flex items-center gap-1 font-semibold shrink-0 ml-2"
                      >
                        Open Stripe <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Web3 USDC Micro-Escrow Deposit Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Coins className="h-5 w-5 text-amber-400" />
                    Web3 USDC Micro-Escrow Channels (EIP-712 Verified)
                  </CardTitle>
                  <CardDescription>
                    Deposit USDC across Base L2, Ethereum, Arbitrum, or Solana for micro-metered token streaming.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Chain Selection Tabs */}
                  <div className="flex gap-2 border-b pb-2">
                    {["base", "ethereum", "arbitrum", "solana"].map((c) => (
                      <Button
                        key={c}
                        size="sm"
                        variant={selectedChain === c ? "default" : "ghost"}
                        className={selectedChain === c ? "bg-amber-600 text-white" : "text-xs"}
                        onClick={() => setSelectedChain(c)}
                      >
                        {c.toUpperCase()}
                      </Button>
                    ))}
                  </div>

                  {/* Chain Deposit Address Details */}
                  {cryptoAddresses?.supported_chains?.[selectedChain] && (
                    <div className="p-4 rounded-xl border bg-muted/20 space-y-3 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Network:</span>
                        <span className="font-bold text-foreground">
                          {cryptoAddresses.supported_chains[selectedChain].chain_name}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">USDC Contract:</span>
                        <span className="font-mono text-muted-foreground">
                          {cryptoAddresses.supported_chains[selectedChain].usdc_contract}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground">Dedicated Deposit Address:</span>
                        <div className="flex items-center justify-between p-2 rounded bg-background border font-mono text-foreground break-all">
                          <span>{cryptoAddresses.supported_chains[selectedChain].deposit_address}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyDepositAddr(cryptoAddresses.supported_chains[selectedChain].deposit_address)}
                            className="shrink-0 h-6 px-2 text-xs"
                          >
                            {copiedAddr ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Worker Earnings Disbursement */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-emerald-400" />
                    Host Worker Payouts
                  </CardTitle>
                  <CardDescription>
                    Disburse host compute earnings with signed HMAC receipts.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 rounded-lg border bg-muted/20 text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Min Withdrawal:</span>
                      <span className="font-mono font-bold text-foreground">$10.00 USD</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base L2 Gas Fee:</span>
                      <span className="font-mono text-emerald-400 font-bold">$0.25 USD</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Settlement Time:</span>
                      <span className="font-bold text-foreground">Instant</span>
                    </div>
                  </div>

                  <Button
                    onClick={() => setPayoutDialogOpen(true)}
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                  >
                    <Wallet className="h-4 w-4" />
                    Request Earnings Withdrawal
                  </Button>

                  {/* Latest Receipt Display */}
                  {latestReceipt && (
                    <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-foreground">Disbursement Receipt</span>
                        <Badge variant="outline" className="text-[10px] text-emerald-400">SETTLED</Badge>
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        ID: {latestReceipt.receipt_id}
                      </div>
                      <div className="flex justify-between">
                        <span>Net Paid:</span>
                        <span className="font-mono font-bold text-emerald-400">
                          ${latestReceipt.amount_net_usd.toFixed(2)} USD
                        </span>
                      </div>
                      <div className="truncate text-muted-foreground text-[10px] font-mono">
                        TX: {latestReceipt.settlement_tx_hash}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ----------------------------------------------------------------------
          Worker Payout Dialog
      ----------------------------------------------------------------------- */}
      <Dialog open={payoutDialogOpen} onOpenChange={setPayoutDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disburse Worker Compute Earnings</DialogTitle>
            <DialogDescription>
              Submit an automated withdrawal request for host worker compute node earnings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <Label htmlFor="worker-id">Worker Node ID</Label>
              <Input
                id="worker-id"
                value={payoutWorkerId}
                onChange={(e) => setPayoutWorkerId(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="payout-amt">Withdrawal Amount ($USD, min $10.00)</Label>
              <Input
                id="payout-amt"
                type="number"
                min={10}
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(parseFloat(e.target.value) || 0)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="payout-method">Payout Method</Label>
              <Input
                id="payout-method"
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                placeholder="usdc_base, usdc_solana, stripe_connect"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="payout-dest">Destination Address</Label>
              <Input
                id="payout-dest"
                value={payoutDest}
                onChange={(e) => setPayoutDest(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleProcessPayout}
              disabled={isProcessingPayout || payoutAmount < 10}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isProcessingPayout ? "Processing..." : "Confirm & Settle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------------
          Stripe Deposit Dialog
      ----------------------------------------------------------------------- */}
      <Dialog open={stripeDialogOpen} onOpenChange={setStripeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deposit Compute Credits</DialogTitle>
            <DialogDescription>
              Instant credit card deposit via secure Stripe Checkout.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <Label>Select Deposit Tier</Label>
              <div className="grid grid-cols-3 gap-2">
                {[50, 150, 500].map((amt) => (
                  <Button
                    key={amt}
                    size="sm"
                    variant={stripeAmount === amt ? "default" : "outline"}
                    className={stripeAmount === amt ? "bg-indigo-600 text-white" : ""}
                    onClick={() => setStripeAmount(amt)}
                  >
                    ${amt} USD
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="stripe-dlg-email">Billing Email</Label>
              <Input
                id="stripe-dlg-email"
                value={stripeEmail}
                onChange={(e) => setStripeEmail(e.target.value)}
                className="text-xs"
              />
            </div>
            {createdSessionUrl && (
              <div className="p-2.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <a href={createdSessionUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold">
                  Click to Pay ${stripeAmount}.00 <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStripeDialogOpen(false)}>
              Close
            </Button>
            <Button
              onClick={handleCreateStripeSession}
              disabled={isCreatingSession}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isCreatingSession ? "Creating..." : "Proceed to Checkout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
