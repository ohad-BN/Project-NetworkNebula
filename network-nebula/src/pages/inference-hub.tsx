import { useEffect, useState } from "react";
import {
  Server,
  Zap,
  Terminal,
  Send,
  Trash2,
  Copy,
  Check,
  RotateCw,
  Sparkles,
  Layers,
  Code2,
  Gauge,
  GitCompare,
  TrendingUp,
  Cpu,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiClient } from "@/services/api/client";
import { toast } from "sonner";

interface EndpointItem {
  id: string;
  name: string;
  model_id: string;
  adapter_url?: string;
  status: string;
  min_replicas: number;
  max_replicas: number;
  total_requests: number;
  avg_latency_ms: number;
  created_at: string;
}

interface BenchmarkResult {
  model_id: string;
  adapter_url?: string;
  adapter_name?: string;
  device: string;
  total_prompts_evaluated: number;
  total_tokens_generated: number;
  avg_latency_ms: number;
  avg_tokens_per_sec: number;
  avg_perplexity: number;
  instruction_accuracy_score: number;
  benchmark_duration_seconds: number;
  details: Array<{
    prompt_id: string;
    category: string;
    prompt: string;
    response: string;
    completion_tokens: number;
    latency_ms: number;
    tokens_per_sec: number;
    perplexity: number;
  }>;
}

interface ComparisonResult {
  prompt: string;
  model_a: {
    model_id: string;
    adapter_url?: string;
    adapter_name?: string;
    content: string;
    completion_tokens: number;
    latency_ms: number;
    tokens_per_sec: number;
  };
  model_b: {
    model_id: string;
    adapter_url?: string;
    adapter_name?: string;
    content: string;
    completion_tokens: number;
    latency_ms: number;
    tokens_per_sec: number;
  };
  comparison: {
    faster_model: string;
    latency_diff_ms: number;
    speed_diff_tok_s: number;
  };
}

export function InferenceHubPage() {
  const [activeTab, setActiveTab] = useState<"endpoints" | "compare" | "benchmark">("endpoints");
  const [endpoints, setEndpoints] = useState<EndpointItem[]>([]);
  const [models, setModels] = useState<Array<{ id: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeployOpen, setIsDeployOpen] = useState(false);

  // Deploy Form
  const [deployName, setDeployName] = useState("");
  const [deployModelId, setDeployModelId] = useState("Qwen/Qwen2.5-0.5B-Instruct");
  const [deployAdapterUrl, setDeployAdapterUrl] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);

  // Playground State
  const [selectedModel, setSelectedModel] = useState("Qwen/Qwen2.5-0.5B-Instruct");
  const [systemPrompt, setSystemPrompt] = useState("You are a professional Enterprise AI assistant.");
  const [userPrompt, setUserPrompt] = useState("Hello, can you explain what makes decentralized GPU compute fast?");
  const [isStream, setIsStream] = useState(false);
  const [playgroundOutput, setPlaygroundOutput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStats, setGenerationStats] = useState<{ tokens?: number; latency?: number } | null>(null);

  // Side-by-Side Comparison State
  const [compareModelA, setCompareModelA] = useState("Qwen/Qwen2.5-0.5B-Instruct");
  const [compareAdapterA, setCompareAdapterA] = useState("");
  const [compareModelB, setCompareModelB] = useState("Qwen/Qwen2.5-1.5B-Instruct");
  const [compareAdapterB, setCompareAdapterB] = useState("");
  const [comparePrompt, setComparePrompt] = useState("Explain the difference between data parallelism and tensor parallelism in 2 concise sentences.");
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);

  // Benchmark State
  const [benchmarkModel, setBenchmarkModel] = useState("Qwen/Qwen2.5-0.5B-Instruct");
  const [benchmarkAdapterUrl, setBenchmarkAdapterUrl] = useState("");
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResult | null>(null);

  // Snippet Copy State
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  const fetchEndpoints = async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get<EndpointItem[]>("/api/v1/inference/endpoints");
      setEndpoints(res.data);
    } catch (err: any) {
      toast.error("Failed to fetch inference endpoints");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchModels = async () => {
    try {
      const res = await apiClient.get("/v1/models");
      if (res.data?.data) {
        // Filter out simulated/unsupported models: only display genuine active hardware models
        const realPrefixes = ["Qwen/Qwen2.5-0.5B", "Qwen/Qwen2.5-1.5B", "Qwen/Qwen2.5-7B"];
        const realModels = res.data.data.filter((m: { id: string }) =>
          realPrefixes.some((p) => m.id.startsWith(p)) || !m.id.includes("/")
        );
        setModels(realModels.length > 0 ? realModels : res.data.data);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchEndpoints();
    fetchModels();
  }, []);

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deployName.trim()) {
      toast.error("Endpoint name is required");
      return;
    }
    try {
      setIsDeploying(true);
      await apiClient.post("/api/v1/inference/endpoints", {
        name: deployName.trim(),
        model_id: deployModelId,
        adapter_url: deployAdapterUrl.trim() || undefined,
        min_replicas: 1,
        max_replicas: 4,
      });
      toast.success(`Endpoint '${deployName}' deployed successfully`);
      setIsDeployOpen(false);
      setDeployName("");
      setDeployAdapterUrl("");
      fetchEndpoints();
      fetchModels();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to deploy endpoint");
    } finally {
      setIsDeploying(false);
    }
  };

  const handleDeleteEndpoint = async (endpointId: string, name: string) => {
    try {
      await apiClient.delete(`/api/v1/inference/endpoints/${endpointId}`);
      toast.info(`Endpoint '${name}' undeployed`);
      fetchEndpoints();
      fetchModels();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to undeploy endpoint");
    }
  };

  const handleSendPrompt = async () => {
    if (!userPrompt.trim()) return;
    try {
      setIsGenerating(true);
      setPlaygroundOutput("");
      setGenerationStats(null);
      const startTime = performance.now();

      const messages = [
        ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: userPrompt },
      ];

      const storedKey = localStorage.getItem("api_key") || "";
      const streamHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (storedKey) {
        streamHeaders["Authorization"] = `Bearer ${storedKey}`;
        streamHeaders["X-API-Key"] = storedKey;
      }

      if (isStream) {
        const streamEndpoint = typeof window !== "undefined" && window.location.port !== "5173"
          ? "/v1/chat/completions"
          : `${window.location.protocol}//${window.location.hostname}:8000/v1/chat/completions`;
        const response = await fetch(streamEndpoint, {
          method: "POST",
          headers: streamHeaders,
          body: JSON.stringify({
            model: selectedModel,
            messages,
            stream: true,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          throw new Error(errData?.detail || `Inference error: HTTP ${response.status}`);
        }

        if (!response.body) throw new Error("No readable stream");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let accumulated = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ") && !trimmed.includes("[DONE]")) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const text = parsed.choices?.[0]?.delta?.content || "";
                accumulated += text;
                setPlaygroundOutput(accumulated);
              } catch {
                // Ignore partial JSON parse chunk
              }
            }
          }
        }
        setGenerationStats({ latency: Math.round(performance.now() - startTime) });
      } else {
        const res = await apiClient.post("/v1/chat/completions", {
          model: selectedModel,
          messages,
          stream: false,
        });
        const choice = res.data?.choices?.[0];
        setPlaygroundOutput(choice?.message?.content || "No response");
        setGenerationStats({
          tokens: res.data?.usage?.total_tokens,
          latency: Math.round(performance.now() - startTime),
        });
        fetchEndpoints();
      }
    } catch (err: any) {
      toast.error(err.message || err.response?.data?.detail || "Inference call failed");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRunSideBySide = async () => {
    if (!comparePrompt.trim()) {
      toast.error("Please enter a test prompt for side-by-side comparison");
      return;
    }
    try {
      setIsComparing(true);
      const res = await apiClient.post("/api/v1/models/compare", {
        prompt: comparePrompt.trim(),
        model_a: compareModelA,
        adapter_url_a: compareAdapterA.trim() || undefined,
        model_b: compareModelB,
        adapter_url_b: compareAdapterB.trim() || undefined,
        max_tokens: 64,
        temperature: 0.7,
      });
      setComparisonResult(res.data.comparison);
      toast.success("Side-by-side comparison completed");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Side-by-side comparison failed");
    } finally {
      setIsComparing(false);
    }
  };

  const handleRunBenchmark = async () => {
    try {
      setIsBenchmarking(true);
      const res = await apiClient.post("/api/v1/models/benchmark", {
        model_id: benchmarkModel,
        adapter_url: benchmarkAdapterUrl.trim() || undefined,
        max_tokens: 32,
      });
      setBenchmarkResult(res.data.benchmark);
      toast.success("Benchmark evaluation completed");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Benchmark evaluation failed");
    } finally {
      setIsBenchmarking(false);
    }
  };

  const copyToClipboard = (text: string, tab: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    toast.success("Snippet copied to clipboard");
    setTimeout(() => setCopiedTab(null), 2000);
  };

  const pythonSnippet = `from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="nebula_sk_your_api_token_here"
)

response = client.chat.completions.create(
    model="${selectedModel}",
    messages=[
        {"role": "system", "content": "${systemPrompt}"},
        {"role": "user", "content": "${userPrompt}"}
    ],
    temperature=0.7,
    stream=${isStream ? "True" : "False"}
)

print(response.choices[0].message.content)`;

  const curlSnippet = `curl http://localhost:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer nebula_sk_your_api_token_here" \\
  -d '{
    "model": "${selectedModel}",
    "messages": [
      {"role": "user", "content": "${userPrompt}"}
    ],
    "temperature": 0.7,
    "stream": ${isStream ? "true" : "false"}
  }'`;

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Server className="h-8 w-8 text-primary" />
            Model Serving & OpenAI API Gateway
          </h1>
          <p className="text-muted-foreground mt-1">
            Deploy dedicated high-availability endpoints with drop-in OpenAI Python SDK, live evaluation benchmarking & side-by-side comparison
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchEndpoints} className="gap-2">
            <RotateCw className="h-4 w-4" />
            Refresh
          </Button>

          <Dialog open={isDeployOpen} onOpenChange={setIsDeployOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Zap className="h-4 w-4 fill-current" />
                Deploy Model Endpoint
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Deploy Dedicated Serving Endpoint</DialogTitle>
                <DialogDescription>
                  Allocate dedicated zero-trust GPU workers to host an active inference service.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleDeploy} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="endpointName">Endpoint Identifier</Label>
                  <Input
                    id="endpointName"
                    placeholder="e.g. legal-agent-prod"
                    value={deployName}
                    onChange={(e) => setDeployName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modelSelect">Base Foundation Model</Label>
                  <select
                    id="modelSelect"
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring"
                    value={deployModelId}
                    onChange={(e) => setDeployModelId(e.target.value)}
                  >
                    <option value="Qwen/Qwen2.5-0.5B-Instruct">Qwen/Qwen2.5-0.5B (Active Local Hardware)</option>
                    <option value="Qwen/Qwen2.5-1.5B-Instruct">Qwen/Qwen2.5-1.5B (Active Local Hardware)</option>
                    <option value="Qwen/Qwen2.5-7B-Instruct">Qwen/Qwen2.5-7B (Production Serving)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adapterUrl">LoRA Adapter S3 Checkpoint (Optional)</Label>
                  <Input
                    id="adapterUrl"
                    placeholder="s3://nebula-checkpoints/lora-adapter-final.safetensors"
                    value={deployAdapterUrl}
                    onChange={(e) => setDeployAdapterUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Hot-swaps LoRA weights in GPU VRAM on demand for fine-tuned serving.
                  </p>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsDeployOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isDeploying}>
                    {isDeploying ? "Deploying..." : "Launch Endpoint"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Navigation Mode Tabs */}
      <div className="flex items-center gap-2 border-b pb-3 mb-6">
        <Button
          variant={activeTab === "endpoints" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("endpoints")}
          className="gap-2"
        >
          <Layers className="h-4 w-4" />
          Endpoints & Playground
        </Button>
        <Button
          variant={activeTab === "compare" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("compare")}
          className="gap-2"
        >
          <GitCompare className="h-4 w-4" />
          Side-by-Side Comparison
        </Button>
        <Button
          variant={activeTab === "benchmark" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("benchmark")}
          className="gap-2"
        >
          <Gauge className="h-4 w-4" />
          Live Model Benchmark
        </Button>
      </div>

      {/* TAB 1: ENDPOINTS & SINGLE PLAYGROUND */}
      {activeTab === "endpoints" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-primary" />
                    Dedicated Serving Endpoints
                  </span>
                  <Badge variant="secondary">{endpoints.length} Active</Badge>
                </CardTitle>
                <CardDescription>
                  Customer-managed endpoints with auto-scaling replicas and hot-swapped LoRA weights
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    Loading endpoints...
                  </div>
                ) : endpoints.length === 0 ? (
                  <div className="py-8 text-center border rounded-lg border-dashed">
                    <Server className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">No custom endpoints deployed</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Deploy a dedicated endpoint to bind fine-tuned checkpoints with dedicated SLA guarantees
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="pb-2 font-medium">Name</th>
                          <th className="pb-2 font-medium">Model</th>
                          <th className="pb-2 font-medium">Adapter</th>
                          <th className="pb-2 font-medium">Replicas</th>
                          <th className="pb-2 font-medium">Requests</th>
                          <th className="pb-2 font-medium">Latency</th>
                          <th className="pb-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {endpoints.map((ep) => (
                          <tr key={ep.id} className="hover:bg-muted/50">
                            <td className="py-2.5 font-medium">{ep.name}</td>
                            <td className="py-2.5 text-xs text-muted-foreground">{ep.model_id}</td>
                            <td className="py-2.5 text-xs">
                              {ep.adapter_url ? (
                                <Badge variant="outline" className="font-mono text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
                                  LoRA Checkpoint
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">Base</span>
                              )}
                            </td>
                            <td className="py-2.5 text-xs font-mono">{ep.min_replicas}-{ep.max_replicas}</td>
                            <td className="py-2.5 text-xs font-mono">{ep.total_requests}</td>
                            <td className="py-2.5 text-xs font-mono">{ep.avg_latency_ms ? `${ep.avg_latency_ms.toFixed(1)}ms` : "—"}</td>
                            <td className="py-2.5 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeleteEndpoint(ep.id, ep.name)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-primary" />
                  OpenAI SDK Integration Snippet
                </CardTitle>
                <CardDescription>
                  Copy and run against your NetworkNebula endpoint using any standard OpenAI SDK
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <div className="text-xs font-semibold text-muted-foreground">Python SDK (openai)</div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => copyToClipboard(pythonSnippet, "python")}
                    >
                      {copiedTab === "python" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      Copy Python
                    </Button>
                  </div>
                  <pre className="p-3 bg-muted/60 rounded text-xs font-mono overflow-x-auto text-foreground/90">
                    {pythonSnippet}
                  </pre>

                  <div className="flex items-center justify-between border-b pt-3 pb-2">
                    <div className="text-xs font-semibold text-muted-foreground">cURL Terminal</div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => copyToClipboard(curlSnippet, "curl")}
                    >
                      {copiedTab === "curl" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      Copy cURL
                    </Button>
                  </div>
                  <pre className="p-3 bg-muted/60 rounded text-xs font-mono overflow-x-auto text-foreground/90">
                    {curlSnippet}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-5">
            <Card className="h-full flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  Live API Playground
                </CardTitle>
                <CardDescription>
                  Test inference queries live against the OpenAI Gateway
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 flex-1 flex flex-col">
                <div className="space-y-2">
                  <Label htmlFor="playgroundModel">Active Model / Endpoint</Label>
                  <select
                    id="playgroundModel"
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  >
                    <optgroup label="Dedicated Deployed Endpoints">
                      {endpoints.map((ep) => (
                        <option key={ep.id} value={ep.name}>{ep.name} ({ep.model_id})</option>
                      ))}
                    </optgroup>
                    <optgroup label="Foundation Cluster Models">
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="systemPrompt">System Directive</Label>
                  <Input
                    id="systemPrompt"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                  />
                </div>

                <div className="space-y-2 flex-1">
                  <Label htmlFor="userPrompt">User Prompt</Label>
                  <Textarea
                    id="userPrompt"
                    rows={3}
                    value={userPrompt}
                    onChange={(e) => setUserPrompt(e.target.value)}
                    placeholder="Enter message for the model..."
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isStream}
                      onChange={(e) => setIsStream(e.target.checked)}
                      className="rounded border-input text-primary focus:ring-primary"
                    />
                    <span>Stream SSE tokens</span>
                  </label>
                  <Button size="sm" onClick={handleSendPrompt} disabled={isGenerating} className="gap-2">
                    <Send className="h-3.5 w-3.5" />
                    {isGenerating ? "Inferring..." : "Send Request"}
                  </Button>
                </div>

                <div className="mt-4 flex-1 flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <Terminal className="h-3.5 w-3.5" /> Response Stream
                    </Label>
                    {generationStats && (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {generationStats.tokens ? `${generationStats.tokens} tokens • ` : ""}{generationStats.latency}ms
                      </span>
                    )}
                  </div>
                  <div className="p-3 rounded-md bg-muted/40 border font-mono text-xs flex-1 min-h-[160px] whitespace-pre-wrap overflow-y-auto">
                    {playgroundOutput || (
                      <span className="text-muted-foreground italic">
                        {isGenerating ? "Streaming tokens from GPU compute node..." : "Click 'Send Request' to query the endpoint."}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: SIDE-BY-SIDE COMPARISON PLAYGROUND */}
      {activeTab === "compare" && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <GitCompare className="h-5 w-5 text-indigo-500" />
                Side-by-Side Model Comparison Playground
              </CardTitle>
              <CardDescription>
                Simultaneously evaluate generation quality, latency (ms), and token generation speed (tok/sec) across two foundation models or fine-tuned PEFT checkpoints
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-muted/30 border">
                {/* Model A Configuration */}
                <div className="space-y-2">
                  <Label className="font-semibold text-xs text-primary flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5" /> Model / Endpoint A
                  </Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={compareModelA}
                    onChange={(e) => setCompareModelA(e.target.value)}
                  >
                    <optgroup label="Foundation Models">
                      {models.map((m) => (
                        <option key={`a-${m.id}`} value={m.id}>{m.id}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Deployed Endpoints">
                      {endpoints.map((ep) => (
                        <option key={`a-ep-${ep.id}`} value={ep.name}>{ep.name}</option>
                      ))}
                    </optgroup>
                  </select>
                  <Input
                    placeholder="Optional S3 LoRA Checkpoint URL (Model A)"
                    className="text-xs h-8"
                    value={compareAdapterA}
                    onChange={(e) => setCompareAdapterA(e.target.value)}
                  />
                </div>

                {/* Model B Configuration */}
                <div className="space-y-2">
                  <Label className="font-semibold text-xs text-indigo-400 flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5" /> Model / Endpoint B
                  </Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={compareModelB}
                    onChange={(e) => setCompareModelB(e.target.value)}
                  >
                    <optgroup label="Foundation Models">
                      {models.map((m) => (
                        <option key={`b-${m.id}`} value={m.id}>{m.id}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Deployed Endpoints">
                      {endpoints.map((ep) => (
                        <option key={`b-ep-${ep.id}`} value={ep.name}>{ep.name}</option>
                      ))}
                    </optgroup>
                  </select>
                  <Input
                    placeholder="Optional S3 LoRA Checkpoint URL (Model B)"
                    className="text-xs h-8"
                    value={compareAdapterB}
                    onChange={(e) => setCompareAdapterB(e.target.value)}
                  />
                </div>
              </div>

              {/* Shared Prompt */}
              <div className="space-y-2">
                <Label htmlFor="comparePrompt">Shared Benchmark Prompt</Label>
                <div className="flex gap-2">
                  <Textarea
                    id="comparePrompt"
                    rows={2}
                    value={comparePrompt}
                    onChange={(e) => setComparePrompt(e.target.value)}
                    placeholder="Enter prompt to evaluate across both models..."
                    className="flex-1"
                  />
                  <Button
                    onClick={handleRunSideBySide}
                    disabled={isComparing}
                    className="self-end gap-2 bg-indigo-600 hover:bg-indigo-700"
                  >
                    <GitCompare className="h-4 w-4" />
                    {isComparing ? "Comparing..." : "Compare Models"}
                  </Button>
                </div>
              </div>

              {/* Results Comparison Grid */}
              {comparisonResult && (
                <div className="space-y-4 pt-2">
                  {/* Delta Banner */}
                  <div className="p-3 rounded-md bg-indigo-950/40 border border-indigo-800/40 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-indigo-400" />
                      <span className="font-semibold">Fastest Engine:</span>
                      <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">
                        {comparisonResult.comparison.faster_model}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-muted-foreground font-mono">
                      <span>Latency Delta: {comparisonResult.comparison.latency_diff_ms > 0 ? `+${comparisonResult.comparison.latency_diff_ms}` : comparisonResult.comparison.latency_diff_ms}ms</span>
                      <span>Throughput Delta: {comparisonResult.comparison.speed_diff_tok_s > 0 ? `+${comparisonResult.comparison.speed_diff_tok_s}` : comparisonResult.comparison.speed_diff_tok_s} tok/sec</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Pane A */}
                    <Card className="border-primary/30">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold truncate">
                            {comparisonResult.model_a.model_id}
                          </CardTitle>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {comparisonResult.model_a.tokens_per_sec} tok/s
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                          <span>{comparisonResult.model_a.latency_ms}ms</span>
                          <span>{comparisonResult.model_a.completion_tokens} tokens</span>
                          {comparisonResult.model_a.adapter_name && (
                            <Badge variant="outline" className="text-[10px] text-purple-400">
                              {comparisonResult.model_a.adapter_name}
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="p-3 rounded bg-muted/40 font-mono text-xs whitespace-pre-wrap min-h-[160px]">
                          {comparisonResult.model_a.content}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Pane B */}
                    <Card className="border-indigo-500/30">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold truncate">
                            {comparisonResult.model_b.model_id}
                          </CardTitle>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {comparisonResult.model_b.tokens_per_sec} tok/s
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                          <span>{comparisonResult.model_b.latency_ms}ms</span>
                          <span>{comparisonResult.model_b.completion_tokens} tokens</span>
                          {comparisonResult.model_b.adapter_name && (
                            <Badge variant="outline" className="text-[10px] text-purple-400">
                              {comparisonResult.model_b.adapter_name}
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="p-3 rounded bg-muted/40 font-mono text-xs whitespace-pre-wrap min-h-[160px]">
                          {comparisonResult.model_b.content}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: LIVE BENCHMARK SUITE */}
      {activeTab === "benchmark" && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Gauge className="h-5 w-5 text-emerald-500" />
                Live Model Evaluation Benchmark
              </CardTitle>
              <CardDescription>
                Execute automated empirical tests measuring throughput, perplexity loss estimation, and instruction accuracy
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg bg-muted/30 border">
                <div className="space-y-1">
                  <Label className="text-xs">Target Foundation Model</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={benchmarkModel}
                    onChange={(e) => setBenchmarkModel(e.target.value)}
                  >
                    {models.map((m) => (
                      <option key={`bm-${m.id}`} value={m.id}>{m.id}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs">Optional LoRA Adapter URL</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="s3://nebula-checkpoints/... (Optional)"
                      value={benchmarkAdapterUrl}
                      onChange={(e) => setBenchmarkAdapterUrl(e.target.value)}
                      className="h-9"
                    />
                    <Button
                      onClick={handleRunBenchmark}
                      disabled={isBenchmarking}
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700 shrink-0"
                    >
                      <Gauge className="h-4 w-4" />
                      {isBenchmarking ? "Running Benchmark..." : "Execute Suite"}
                    </Button>
                  </div>
                </div>
              </div>

              {benchmarkResult && (
                <div className="space-y-6 pt-2">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg bg-muted/40 border">
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> Throughput
                      </div>
                      <div className="text-2xl font-bold font-mono mt-1 text-emerald-400">
                        {benchmarkResult.avg_tokens_per_sec} <span className="text-xs font-normal text-muted-foreground">tok/s</span>
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/40 border">
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-blue-400" /> Avg Latency
                      </div>
                      <div className="text-2xl font-bold font-mono mt-1">
                        {benchmarkResult.avg_latency_ms} <span className="text-xs font-normal text-muted-foreground">ms</span>
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/40 border">
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Gauge className="h-3.5 w-3.5 text-purple-400" /> Perplexity (PPL)
                      </div>
                      <div className="text-2xl font-bold font-mono mt-1 text-purple-400">
                        {benchmarkResult.avg_perplexity}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/40 border">
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-amber-400" /> Instruction Match
                      </div>
                      <div className="text-2xl font-bold font-mono mt-1 text-amber-400">
                        {benchmarkResult.instruction_accuracy_score}%
                      </div>
                    </div>
                  </div>

                  {/* Benchmark Prompts Table */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Evaluation Test Cases Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="divide-y text-xs">
                        {benchmarkResult.details.map((d, i) => (
                          <div key={i} className="py-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <Badge variant="outline" className="text-[10px] uppercase font-mono">
                                {d.category}
                              </Badge>
                              <div className="flex items-center gap-3 font-mono text-muted-foreground">
                                <span>{d.tokens_per_sec} tok/s</span>
                                <span>{d.latency_ms}ms</span>
                                <span>PPL: {d.perplexity}</span>
                              </div>
                            </div>
                            <div className="font-semibold text-foreground">{d.prompt}</div>
                            <div className="p-2 rounded bg-muted/50 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap">
                              {d.response}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
