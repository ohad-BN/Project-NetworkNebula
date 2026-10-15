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

export function InferenceHubPage() {
  const [endpoints, setEndpoints] = useState<EndpointItem[]>([]);
  const [models, setModels] = useState<Array<{ id: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeployOpen, setIsDeployOpen] = useState(false);

  // Deploy Form
  const [deployName, setDeployName] = useState("");
  const [deployModelId, setDeployModelId] = useState("meta-llama/Llama-3-8B");
  const [deployAdapterUrl, setDeployAdapterUrl] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);

  // Playground State
  const [selectedModel, setSelectedModel] = useState("meta-llama/Llama-3-8B");
  const [systemPrompt, setSystemPrompt] = useState("You are a professional Enterprise AI assistant.");
  const [userPrompt, setUserPrompt] = useState("Hello, can you explain what makes decentralized GPU compute fast?");
  const [isStream, setIsStream] = useState(false);
  const [playgroundOutput, setPlaygroundOutput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStats, setGenerationStats] = useState<{ tokens?: number; latency?: number } | null>(null);

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
        setModels(res.data.data);
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

      if (isStream) {
        // SSE streaming via fetch
        const response = await fetch("http://localhost:8000/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModel,
            messages,
            stream: true,
          }),
        });

        if (!response.body) throw new Error("No readable stream");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const text = parsed.choices?.[0]?.delta?.content || "";
                accumulated += text;
                setPlaygroundOutput(accumulated);
              } catch {
                // Ignore parse chunk
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
      toast.error(err.response?.data?.detail || "Inference call failed");
    } finally {
      setIsGenerating(false);
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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Server className="h-8 w-8 text-primary" />
            Model Serving & OpenAI API Gateway
          </h1>
          <p className="text-muted-foreground mt-1">
            Deploy dedicated high-availability endpoints with drop-in OpenAI Python SDK, cURL, and LangChain compatibility
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
                    <option value="meta-llama/Llama-3-8B">meta-llama/Llama-3-8B</option>
                    <option value="mistralai/Mistral-7B-Instruct-v0.3">mistralai/Mistral-7B</option>
                    <option value="Qwen/Qwen2.5-7B-Instruct">Qwen/Qwen2.5-7B</option>
                    <option value="deepseek-ai/DeepSeek-R1-Distill-Qwen-8B">DeepSeek-R1-Distill-8B</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adapterUrl">LoRA Adapter S3 Checkpoint (Optional)</Label>
                  <Input
                    id="adapterUrl"
                    placeholder="http://localhost:9000/nebula-checkpoints/.../adapter_model.safetensors"
                    value={deployAdapterUrl}
                    onChange={(e) => setDeployAdapterUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Attach weights trained in the Training Studio</p>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsDeployOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isDeploying}>
                    {isDeploying ? "Deploying..." : "Deploy Endpoint"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Grid: Endpoints Table & Interactive Playground */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Active Endpoints Fleet (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary" />
                Active Serving Endpoints ({endpoints.length})
              </CardTitle>
              <CardDescription>
                Routing `/v1/chat/completions` traffic directly to decentralized worker pools
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading && endpoints.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <RotateCw className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                  <p>Loading dedicated endpoints...</p>
                </div>
              ) : endpoints.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No dedicated endpoints deployed yet. Default foundation models are active.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                      <tr>
                        <th className="py-3 px-3">Endpoint Name</th>
                        <th className="py-3 px-3">Base Model</th>
                        <th className="py-3 px-3">Requests</th>
                        <th className="py-3 px-3">Avg Latency</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {endpoints.map((ep) => (
                        <tr key={ep.id} className="hover:bg-muted/30">
                          <td className="py-3 px-3 font-semibold text-primary">
                            {ep.name}
                            {ep.adapter_url && (
                              <div className="text-[10px] text-purple-500 font-mono">LoRA Attached</div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs">{ep.model_id}</td>
                          <td className="py-3 px-3 font-mono">{ep.total_requests}</td>
                          <td className="py-3 px-3 font-mono">{ep.avg_latency_ms.toFixed(1)}ms</td>
                          <td className="py-3 px-3">
                            <Badge variant="default" className="bg-emerald-600 text-xs">Ready</Badge>
                          </td>
                          <td className="py-3 px-3 text-right">
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

          {/* Code Integration Snippets */}
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

        {/* Right Column: Live Interactive Playground (5 cols) */}
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

              {/* Output Display */}
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
    </div>
  );
}
