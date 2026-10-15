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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiClient } from "@/services/api/client";
import { toast } from "sonner";

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
  const [baseModel, setBaseModel] = useState("meta-llama/Llama-3-8B");
  const [trainType, setTrainType] = useState("lora");
  const [datasetUrl, setDatasetUrl] = useState("http://localhost:9000/nebula-datasets/enterprise/dataset.jsonl");
  const [epochs, setEpochs] = useState("3");
  const [learningRate, setLearningRate] = useState("0.0002");
  const [loraR, setLoraR] = useState("16");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingUpload, setIsGeneratingUpload] = useState(false);

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

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
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
      const payload = {
        name: jobName.trim() || undefined,
        base_model: baseModel,
        train_type: trainType,
        parallelism: "data_parallel",
        num_gpus: 1,
        dataset_s3_url: datasetUrl,
        total_epochs: parseInt(epochs, 10) || 3,
        hyperparameters: {
          learning_rate: parseFloat(learningRate) || 0.0002,
          batch_size: 4,
          lora_r: parseInt(loraR, 10) || 16,
          lora_alpha: 32
        }
      };
      await apiClient.post("/api/v1/training/jobs", payload);
      toast.success("Training run submitted to GPU compute fleet");
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
                      <option value="meta-llama/Llama-3-8B">meta-llama/Llama-3-8B</option>
                      <option value="mistralai/Mistral-7B-Instruct-v0.3">mistralai/Mistral-7B</option>
                      <option value="Qwen/Qwen2.5-7B-Instruct">Qwen/Qwen2.5-7B</option>
                      <option value="deepseek-ai/DeepSeek-R1-Distill-Qwen-8B">DeepSeek-R1-Distill-8B</option>
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
