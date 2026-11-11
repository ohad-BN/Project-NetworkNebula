import { useEffect, useState, useRef } from "react";
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
  Network,
  Zap,
  Sparkles,
  Lock,
  Unlock,
  Key,
  HardDrive,
  Eye,
  FileCheck,
  ShieldCheck,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiClient, getApiBaseUrl } from "@/services/api/client";
import { toast } from "sonner";
import {
  sealEnvelope,
  saveJobDek,
  getJobDek,
  generateDekBase64,
  exportNebulaKey,
  parseNebulaKey,
  decryptSafetensors,
  downloadSafetensorsFile,
} from "@/lib/sealed-envelope";
import {
  type ByosConfig,
  constructS3Uri,
  loadByosConfig,
  saveByosConfig,
  uploadToPresignedPutUrl,
} from "@/lib/byos-s3";
import {
  type DatasetParseResult,
  type TrainingSample,
  parseDatasetFile,
} from "@/lib/dataset-parser";
import { isWorkerTrainingCapable } from "@/lib/worker-capabilities";

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
  largest_single_gpu_gb?: number;
  collective_vram_gb?: number;
  gpu_count?: number;
  tunnel_pubkey_x25519?: string;
  supports_sealed_env?: boolean;
  supported_task_types?: string;
  training_ready?: boolean;
  missing_training_packages?: string[];
  compute_architecture?: string;
}

function isNodeTrainingCapable(n: ClusterNodeItem): boolean {
  return isWorkerTrainingCapable(n);
}

function generateClientUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function streamRecordsToRamRelay(jobId: string, records: TrainingSample[]): Promise<void> {
  if (!records || records.length === 0) return;
  const apiBase = getApiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  const cleanHttp = apiBase.replace(/\/+$/, "");
  const wsBase = cleanHttp.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  const apiKey = typeof localStorage !== "undefined" ? localStorage.getItem("api_key") || "" : "";
  const url = `${wsBase}/ws/client/stream/${encodeURIComponent(jobId)}?role=client${
    apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : ""
  }`;

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeoutId = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error("Timed out streaming dataset to client RAM relay"));
    }, 15000);

    let streamed = false;
    ws.onmessage = (evt) => {
      try {
        if (evt.data === "pong") {
          clearTimeout(timeoutId);
          ws.close();
          resolve();
          return;
        }
        const msg = JSON.parse(String(evt.data));
        if (msg?.type === "stream_ready" && !streamed) {
          streamed = true;
          const chunkSize = 200;
          for (let i = 0; i < records.length; i += chunkSize) {
            const batch = records.slice(i, i + chunkSize).map((r) => ({
              instruction: r.input ? `${r.instruction}\n${r.input}` : r.instruction,
              response: r.response,
            }));
            ws.send(JSON.stringify({ type: "dataset_stream", records: batch }));
          }
          ws.send("ping");
        }
      } catch {
        // ignore non-json frames except pong
      }
    };
    ws.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error("WebSocket error while streaming dataset to RAM relay"));
    };
  });
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
  training_phase?: {
    phase: string;
    detail?: string;
    progress_pct?: number | null;
    downloaded_mb?: number | null;
    total_mb?: number | null;
    updated_at?: string;
  } | null;
  current_epoch: number;
  total_epochs: number;
  loss_history: Array<{ epoch: number; step: number; loss: number; val_loss?: number; timestamp: string }>;
  checkpoints: Array<{ epoch: number; s3_url: string; size_bytes: number; created_at: string }>;
  final_adapter_url?: string;
  cost: number;
  created_at?: string;
  completed_at?: string;
  privacy_mode?: string;
  data_source_type?: string;
  storage_retention?: string;
}

const POPULAR_PRESETS = [
  { id: "Qwen/Qwen2.5-0.5B-Instruct", name: "Qwen 2.5 (0.5B) - Ultra-lightweight", params: 0.5 },
  { id: "Qwen/Qwen2.5-1.5B-Instruct", name: "Qwen 2.5 (1.5B) - Fast Edge", params: 1.5 },
  { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen 2.5 (7B) - High Quality Production", params: 7.0 },
  { id: "Qwen/Qwen2.5-14B-Instruct", name: "Qwen 2.5 (14B) - Heavy Reasoning", params: 14.0 },
  { id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 (8B) - Meta Open Weights", params: 8.0 },
  { id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", name: "DeepSeek R1 Distill (7B) - Reasoning", params: 7.0 },
  { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B v0.3 - Versatile Instruction", params: 7.0 },
  { id: "google/gemma-2-9b-it", name: "Gemma 2 (9B) - Google Research", params: 9.0 },
];

function getModelParamsB(modelId: string): number {
  const cleanId = (modelId || "").trim().toLowerCase();
  if (!cleanId) return 7.0;
  const preset = POPULAR_PRESETS.find((p) => p.id.toLowerCase() === cleanId);
  if (preset) return preset.params;
  const match = cleanId.match(/(?:^|[-/_])([0-9]+(?:\.[0-9]+)?)\s*([bm])(?=$|[^a-z0-9])/i);
  if (match) {
    const val = parseFloat(match[1]);
    if (!isNaN(val) && val > 0) {
      const unit = match[2].toLowerCase();
      return unit === "m" ? Math.round((val / 1000) * 1000) / 1000 : val;
    }
  }
  return 7.0; // fallback standard 7B
}

export function TrainingStudioPage() {
  const [jobs, setJobs] = useState<TrainingJobItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<TrainingJobItem | null>(null);
  const [isTelemetryModalOpen, setIsTelemetryModalOpen] = useState(false);

  // Form State
  const [jobName, setJobName] = useState("");
  const [baseModel, setBaseModel] = useState("Qwen/Qwen2.5-7B-Instruct");
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [hfToken, setHfToken] = useState("");
  const [trainType, setTrainType] = useState<"lora" | "qlora" | "full">("qlora");
  const [datasetUrl, setDatasetUrl] = useState("s3://nebula-datasets/enterprise/real_alpaca_dataset.jsonl");
  const [epochs, setEpochs] = useState("3");
  const [learningRate, setLearningRate] = useState("0.0002");
  const [loraR, setLoraR] = useState("16");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingUpload, setIsGeneratingUpload] = useState(false);

  // Storage and Material Mode
  const [storageMode, setStorageMode] = useState<"tunnel_stream" | "byos_s3" | "s3_url">("tunnel_stream");
  const [byosConfig, setByosConfig] = useState<ByosConfig | null>(null);
  const [byosUploadUrl, setByosUploadUrl] = useState("");
  const [isByosModalOpen, setIsByosModalOpen] = useState(false);

  // Client Dataset Parser State
  const [parsedDataset, setParsedDataset] = useState<DatasetParseResult | null>(null);
  const [isParsingDataset, setIsParsingDataset] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fleet & Autonomous Compute Distribution State
  const [clusterNodes, setClusterNodes] = useState<ClusterNodeItem[]>([]);
  const [computeStrategy, setComputeStrategy] = useState<"auto_swarm" | "ring_mesh" | "single">("auto_swarm");
  const [gpuScale] = useState<"auto" | "2" | "4">("auto");
  const [devOverrideNodeId] = useState<string>("");

  // Key Recovery & Decryption State
  const [isDecryptingJobId, setIsDecryptingJobId] = useState<string | null>(null);
  const [keyRecoveryModalOpen, setKeyRecoveryModalOpen] = useState(false);
  const [keyRecoveryTargetJob, setKeyRecoveryTargetJob] = useState<TrainingJobItem | null>(null);
  const [manualDekInput, setManualDekInput] = useState("");

  // Derived cluster capacity (strictly isolate training-capable GPUs from monitor/inference-only nodes, while keeping active busy GPUs counted)
  const onlineNodes = clusterNodes.filter(
    (n) => (n.status === "online" || n.status === "busy") && n.is_available !== false
  );
  const trainingReadyNodes = onlineNodes.filter(isNodeTrainingCapable);
  const idleTrainingNodes = trainingReadyNodes.filter((n) => n.status === "online");
  const busyTrainingNodes = trainingReadyNodes.filter((n) => n.status === "busy");
  const monitorOnlyNodes = onlineNodes.filter((n) => !isNodeTrainingCapable(n));
  const totalOnlineVram = trainingReadyNodes.reduce((acc, n) => acc + (n.vram_allocated_gb || n.vram_total_gb || 0), 0);

  // Max single GPU and collective VRAM across training-ready nodes
  const maxSingleGpuGb = trainingReadyNodes.reduce((max, n) => {
    const v = n.largest_single_gpu_gb || n.vram_allocated_gb || n.vram_total_gb || 0;
    return Math.max(max, v);
  }, 0);

  const maxCollectiveVramGb = trainingReadyNodes.reduce((max, n) => {
    const v = n.collective_vram_gb || n.vram_allocated_gb || n.vram_total_gb || 0;
    return Math.max(max, v);
  }, 0);

  // Mathematical Pre-Flight VRAM Calculation:
  // LoRA: ~2.2 * P + 2.0; QLoRA: ~0.65 * P + 1.8; Full: ~8.0 * P + 4.0
  const modelParamsB = getModelParamsB(baseModel);
  const loraRequiredVram = Math.round((2.2 * modelParamsB + 2.0) * 10) / 10;
  const qloraRequiredVram = Math.round((0.65 * modelParamsB + 1.8) * 10) / 10;
  const fullRequiredVram = Math.round((8.0 * modelParamsB + 4.0) * 10) / 10;

  const currentEstimatedVram =
    trainType === "qlora"
      ? qloraRequiredVram
      : trainType === "full"
      ? fullRequiredVram
      : loraRequiredVram;

  // Live Pre-flight VRAM Fit Status
  let vramFitStatus: "fit" | "insufficient" | "queued" = "queued";
  let vramFitMessage = "";

  if (trainingReadyNodes.length === 0) {
    vramFitStatus = "queued";
    vramFitMessage =
      monitorOnlyNodes.length > 0
        ? `Requires ~${currentEstimatedVram} GB VRAM. ${monitorOnlyNodes.length} inference/monitor node(s) online (excluded from training) — awaiting a CUDA/training-ready GPU.`
        : `Requires ~${currentEstimatedVram} GB VRAM. No workers online — job will stay Queued until a node joins.`;
  } else if (currentEstimatedVram <= maxSingleGpuGb) {
    vramFitStatus = "fit";
    vramFitMessage =
      idleTrainingNodes.length === 0 && busyTrainingNodes.length > 0
        ? `Fits on single GPU (${maxSingleGpuGb.toFixed(1)} GB available). ${busyTrainingNodes.length} GPU currently busy — job will queue and auto-dispatch next.`
        : `Fits on single GPU (${maxSingleGpuGb.toFixed(1)} GB available). Instant dispatch ready.`;
  } else if (currentEstimatedVram <= maxCollectiveVramGb) {
    vramFitStatus = "fit";
    vramFitMessage = `Fits on multi-GPU collective VRAM (${maxCollectiveVramGb.toFixed(1)} GB available on node via device_map="auto").`;
  } else {
    vramFitStatus = "insufficient";
    vramFitMessage = `Requires ~${currentEstimatedVram} GB VRAM, but largest online host has ${maxCollectiveVramGb.toFixed(1)} GB. Suggestion: Switch to 4-bit QLoRA (~${qloraRequiredVram} GB).`;
  }

  const fetchJobs = async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get<TrainingJobItem[]>("/api/v1/training/jobs");
      setJobs(res.data);
      setSelectedJob((prev) => (prev ? res.data.find((j) => j.id === prev.id) || prev : prev));
    } catch {
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
    } catch {
      // Ignore telemetry fetch errors
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchClusterNodes();
    setByosConfig(loadByosConfig());
    const interval = setInterval(() => {
      fetchJobs();
      fetchClusterNodes();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle Client Dataset Parsing
  const handleDatasetFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsParsingDataset(true);
      setDatasetFile(file);
      const result = await parseDatasetFile(file);
      setParsedDataset(result);
      if (result.valid) {
        toast.success(
          `Dataset parsed: ${result.totalRecords} records (~${result.estimatedTotalTokens.toLocaleString()} tokens) [${result.formatDetected}]`
        );
      } else {
        toast.error(`Dataset validation failed: ${result.errors[0] || "Unknown format"}`);
      }
    } catch (err: any) {
      toast.error(`Failed to parse dataset file: ${err.message}`);
    } finally {
      setIsParsingDataset(false);
    }
  };

  const handleGenerateUploadUrl = async () => {
    try {
      setIsGeneratingUpload(true);
      const res = await apiClient.post("/api/v1/training/datasets/upload-url", {
        filename: datasetFile ? datasetFile.name : "dataset_enterprise.jsonl",
      });
      setDatasetUrl(res.data.s3_url);
      toast.success("Dataset upload URL generated and assigned to S3 path");
    } catch {
      toast.error("Could not generate S3 dataset URL");
    } finally {
      setIsGeneratingUpload(false);
    }
  };

  // Job Submission with Client Cryptography UX
  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const isSingle = computeStrategy === "single";
      let targetGpus = 1;
      if (!isSingle) {
        if (gpuScale === "auto") {
          targetGpus = Math.max(1, trainingReadyNodes.length);
        } else {
          targetGpus = parseInt(gpuScale, 10);
        }
      }
      const isDistributed = !isSingle && targetGpus >= 2;
      const targetWorkerIds = devOverrideNodeId ? [devOverrideNodeId] : undefined;

      // 1. Generate local DEK & UUID for this job
      const clientDekB64 = generateDekBase64();

      // 2. Prepare UUID upfront so X25519 AAD & RAM stream relay match the created DB job 1:1
      const assignedJobId = generateClientUuid();
      saveJobDek(assignedJobId, clientDekB64);

      let sealedSecretsPayload: any = undefined;

      // 3. If private token or BYOS provided, seal envelope if training worker pubkey available
      const needsSealing = Boolean(hfToken.trim() || storageMode === "byos_s3");

      // Find training-ready worker public key
      const candidatePool = trainingReadyNodes.length > 0 ? trainingReadyNodes : onlineNodes;
      const targetWorker = candidatePool.find((n) =>
        devOverrideNodeId ? n.node_id === devOverrideNodeId : n.tunnel_pubkey_x25519
      );

      if (needsSealing && targetWorker?.tunnel_pubkey_x25519) {
        try {
          const secrets: Record<string, any> = {
            dek_b64: clientDekB64,
          };
          if (hfToken.trim()) {
            secrets.hf_token = hfToken.trim();
          }
          if (storageMode === "byos_s3" && byosConfig) {
            secrets.byos_endpoint = byosConfig.endpoint;
            secrets.byos_bucket = byosConfig.bucket;
            secrets.byos_access_key = byosConfig.accessKeyId;
            secrets.byos_secret_key = byosConfig.secretAccessKey;
          }

          const envelope = await sealEnvelope(secrets, targetWorker.tunnel_pubkey_x25519, assignedJobId);
          sealedSecretsPayload = envelope;
        } catch (sealErr: any) {
          console.warn("Sealing envelope failed:", sealErr);
          toast.warning("Could not seal envelope with worker pubkey; submitting with standard privacy.");
        }
      }

      // 4. Zero-storage dataset preparation:
      // - tunnel_stream: push parsed records to volatile /ws/client/stream/{job_id} RAM buffer before dispatch
      // - byos_s3: direct client-side HTTP PUT to presigned S3/R2 URL (0 B touching Oracle)
      let finalDatasetLocation = datasetUrl;
      if (storageMode === "tunnel_stream") {
        finalDatasetLocation = `tunnel_stream://${assignedJobId}`;
        if (parsedDataset?.records && parsedDataset.records.length > 0) {
          await streamRecordsToRamRelay(assignedJobId, parsedDataset.records);
        }
      } else if (storageMode === "byos_s3") {
        if (byosUploadUrl.trim() && datasetFile) {
          await uploadToPresignedPutUrl(
            byosUploadUrl.trim(),
            datasetFile,
            datasetFile.type || "application/octet-stream"
          );
          if (byosConfig?.bucket) {
            finalDatasetLocation = constructS3Uri(byosConfig.bucket, datasetFile.name, byosConfig.provider);
          } else {
            finalDatasetLocation = byosUploadUrl.trim().split("?")[0];
          }
        } else if (byosConfig?.bucket && datasetFile && !datasetUrl.startsWith("http")) {
          finalDatasetLocation = constructS3Uri(byosConfig.bucket, datasetFile.name, byosConfig.provider);
        }
      }

      const payload: Record<string, any> = {
        client_job_id: assignedJobId,
        name: jobName.trim() || undefined,
        base_model: baseModel,
        train_type: trainType,
        parallelism: computeStrategy === "ring_mesh" ? "model_parallel" : "data_parallel",
        num_gpus: isDistributed ? targetGpus : 1,
        worker_ids: targetWorkerIds,
        dataset_s3_url: finalDatasetLocation,
        data_source_type: storageMode,
        storage_retention: storageMode === "byos_s3" ? "byos" : "zero_retention",
        privacy_mode: "encrypted_staked_mesh",
        total_epochs: parseInt(epochs, 10) || 3,
        hyperparameters: {
          learning_rate: parseFloat(learningRate) || 0.0002,
          batch_size: 4,
          lora_r: parseInt(loraR, 10) || 16,
          lora_alpha: 32,
          compute_strategy: computeStrategy,
          worker_ids: targetWorkerIds,
          model_params_b: modelParamsB,
          required_vram_gb: currentEstimatedVram,
        },
      };

      if (sealedSecretsPayload) {
        payload.sealed_secrets = sealedSecretsPayload;
        payload.sealed_secrets_b64 = sealedSecretsPayload.sealed_secrets_b64;
      }

      const endpoint = isDistributed ? "/api/v1/training/distributed/jobs" : "/api/v1/training/jobs";
      const submitRes = await apiClient.post(endpoint, payload);
      const actualJobId = submitRes.data?.id || assignedJobId;

      // Associate DEK with actual returned job ID if different
      if (actualJobId !== assignedJobId) {
        saveJobDek(actualJobId, clientDekB64);
      }

      // Export key backup for user safety
      exportNebulaKey(actualJobId, clientDekB64, {
        model_id: baseModel,
        notes: `Private DEK for ${jobName || actualJobId}`,
      });

      if (submitRes.data?.status === "queued" && trainingReadyNodes.length === 0) {
        toast.info(
          "Training job queued in memory. .nebulakey downloaded to your computer for safe decryption on completion."
        );
      } else {
        toast.success(
          isDistributed
            ? `Decentralized training job dispatched across ${targetGpus} nodes via autonomous consensus!`
            : "Training job submitted to optimal sovereign worker node (.nebulakey saved)."
        );
      }

      setIsSubmitModalOpen(false);
      setJobName("");
      setHfToken("");
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

  // Local Decryption & Safe Download of .safetensors Adapter
  const extractDownloadError = (err: any): string => {
    const raw = err?.response?.data;
    if (raw instanceof ArrayBuffer) {
      try {
        const text = new TextDecoder().decode(new Uint8Array(raw));
        const parsed = JSON.parse(text);
        if (parsed?.detail) return String(parsed.detail);
        if (text.trim()) return text.trim();
      } catch {
        // fallback below
      }
    } else if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    } else if (raw?.detail) {
      return String(raw.detail);
    }
    return err?.message || String(err);
  };

  const fetchCheckpointArrayBuffer = async (
    job: TrainingJobItem,
    epoch: number,
    rawUrl?: string | null
  ): Promise<ArrayBuffer> => {
    const cleanUrl = (rawUrl || "").trim();
    const isInternalPrivateUrl =
      !cleanUrl ||
      cleanUrl.startsWith("s3://") ||
      cleanUrl.includes("/nebula-checkpoints/") ||
      /^https?:\/\/(minio|localhost|127\.0\.0\.1):9000\//i.test(cleanUrl);

    if (!isInternalPrivateUrl && /^https?:\/\//i.test(cleanUrl)) {
      const resp = await fetch(cleanUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching external checkpoint file`);
      const ctype = (resp.headers.get("content-type") || "").toLowerCase();
      if (ctype.includes("text/html")) {
        throw new Error("External checkpoint URL returned HTML instead of binary weights.");
      }
      return await resp.arrayBuffer();
    }

    const downloadEndpoint = `/api/v1/training/jobs/${job.id}/checkpoints/${epoch}/download`;
    const resp = await apiClient.get(downloadEndpoint, { responseType: "arraybuffer" });
    const ctype = String(resp.headers?.["content-type"] || "").toLowerCase();
    if (ctype.includes("text/html")) {
      throw new Error("Checkpoint download endpoint returned HTML instead of binary weights.");
    }
    return resp.data;
  };

  const handleDecryptAndDownload = async (job: TrainingJobItem) => {
    const dek = getJobDek(job.id);
    if (!dek) {
      // Prompt user to provide DEK or upload .nebulakey
      setKeyRecoveryTargetJob(job);
      setKeyRecoveryModalOpen(true);
      return;
    }

    await executeDecryptSafetensors(job, dek);
  };

  const executeDecryptSafetensors = async (job: TrainingJobItem, dekB64: string) => {
    try {
      setIsDecryptingJobId(job.id);
      toast.info(`Fetching adapter weights for ${job.name || job.id}...`);

      const lastCkpt = job.checkpoints?.length
        ? job.checkpoints[job.checkpoints.length - 1]
        : null;
      const targetEpoch = lastCkpt?.epoch || job.current_epoch || 1;
      const rawUrl = lastCkpt?.s3_url || job.final_adapter_url;
      const arrayBuffer = await fetchCheckpointArrayBuffer(job, targetEpoch, rawUrl);

      toast.info("Decrypting .safetensors in browser memory using client DEK...");
      const decryptedBytes = await decryptSafetensors(arrayBuffer, dekB64, job.id);

      const filename = `${(job.name || job.id).replace(/[^a-zA-Z0-9_-]/g, "_")}-adapter.safetensors`;
      downloadSafetensorsFile(decryptedBytes, filename);
      toast.success(`Successfully decrypted & saved '${filename}'!`);
      setKeyRecoveryModalOpen(false);
    } catch (err: any) {
      toast.error(`Decryption failed: ${extractDownloadError(err)}`);
    } finally {
      setIsDecryptingJobId(null);
    }
  };

  const handleDownloadRawCheckpoint = async (
    job: TrainingJobItem,
    epoch: number,
    rawUrl?: string | null
  ) => {
    try {
      setIsDecryptingJobId(job.id);
      const arrayBuffer = await fetchCheckpointArrayBuffer(job, epoch, rawUrl);
      const safeName = (job.name || job.id).replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `${safeName}-epoch${epoch}-adapter.safetensors`;
      downloadSafetensorsFile(new Uint8Array(arrayBuffer), filename);
      toast.success(`Downloaded '${filename}'`);
    } catch (err: any) {
      toast.error(`Download failed: ${extractDownloadError(err)}`);
    } finally {
      setIsDecryptingJobId(null);
    }
  };

  const handleNebulaKeyFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseNebulaKey(text);
      setManualDekInput(parsed.dek_b64);
      saveJobDek(parsed.job_id, parsed.dek_b64);
      toast.success(`Loaded .nebulakey for job ${parsed.job_id.slice(0, 8)}`);
    } catch (err: any) {
      toast.error(`Invalid .nebulakey file: ${err.message}`);
    }
  };

  const openTelemetry = (job: TrainingJobItem) => {
    setSelectedJob(job);
    setIsTelemetryModalOpen(true);
  };

  const getStatusBadge = (status: TrainingJobItem["status"]) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="default" className="bg-emerald-600 gap-1">
            <CheckCircle2 className="h-3 w-3" /> Completed
          </Badge>
        );
      case "running":
        return (
          <Badge variant="secondary" className="bg-sky-600 text-white animate-pulse gap-1">
            <RotateCw className="h-3 w-3 animate-spin" /> Running
          </Badge>
        );
      case "queued":
        return (
          <Badge variant="outline" className="border-amber-500 text-amber-500 gap-1">
            <Clock className="h-3 w-3" /> Queued
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="text-muted-foreground gap-1">
            <XCircle className="h-3 w-3" /> Cancelled
          </Badge>
        );
      default:
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" /> Failed
          </Badge>
        );
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
            Fine-tune arbitrary foundation models (LoRA, 4-bit QLoRA) on collective GPU clusters with zero-storage sealed cryptography
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchJobs} className="gap-2">
            <RotateCw className="h-4 w-4" />
            Refresh
          </Button>

          {/* Launch Modal */}
          <Dialog open={isSubmitModalOpen} onOpenChange={setIsSubmitModalOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 shadow-sm">
                <Play className="h-4 w-4 fill-current" />
                Launch Training Run
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-primary" />
                  Launch Enterprise Fine-Tuning Run
                </DialogTitle>
                <DialogDescription>
                  Configure model, sealed secrets, and universal training materials. Workloads are dynamically routed to verified GPU nodes with 0 B persistent middleman storage.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreateJob} className="space-y-5 mt-3">
                {/* Job Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="jobName">Job Name (Optional)</Label>
                  <Input
                    id="jobName"
                    placeholder="e.g. LegalContract-Llama3-v1"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </div>

                {/* Foundation Model Selection */}
                <div className="space-y-2 rounded-lg border border-border/70 p-3.5 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="baseModel" className="font-semibold flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Foundation Model
                    </Label>
                    <button
                      type="button"
                      onClick={() => setIsCustomModel(!isCustomModel)}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      {isCustomModel ? "← Choose Popular Preset" : "+ Enter Arbitrary HuggingFace Model ID"}
                    </button>
                  </div>

                  {isCustomModel ? (
                    <div className="space-y-1">
                      <Input
                        id="customModel"
                        placeholder="e.g. mistralai/Mistral-7B-Instruct-v0.3 or HuggingFaceTB/SmolLM-135M"
                        value={baseModel}
                        onChange={(e) => setBaseModel(e.target.value)}
                        required
                        className="font-mono text-sm"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Accepts any public or private HuggingFace model repository ID. Uncached weights download directly to your worker on first run (GPU starts once downloaded).
                      </p>
                    </div>
                  ) : (
                    <select
                      id="baseModel"
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring"
                      value={baseModel}
                      onChange={(e) => setBaseModel(e.target.value)}
                    >
                      {POPULAR_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.id})
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Private HuggingFace Token Input */}
                  <div className="pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <Label htmlFor="hfToken" className="text-xs font-medium flex items-center gap-1 text-muted-foreground">
                        <Lock className="h-3 w-3 text-amber-500" />
                        Private / Gated Model Access Token (Optional)
                      </Label>
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30">
                        Sealed via Worker X25519
                      </Badge>
                    </div>
                    <Input
                      id="hfToken"
                      type="password"
                      placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={hfToken}
                      onChange={(e) => setHfToken(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Token is sealed in browser RAM before dispatch. Oracle coordinator never sees plaintext credentials.
                    </p>
                  </div>
                </div>

                {/* Fine-Tuning Method & VRAM Fit Indicator */}
                <div className="space-y-3 rounded-lg border border-border/70 p-3.5 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="trainType" className="font-semibold flex items-center gap-1.5">
                      <Sliders className="h-4 w-4 text-primary" />
                      Fine-Tuning Method
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Est. Model Size:</span>
                      <Badge variant="secondary" className="font-mono text-xs">
                        ~{modelParamsB < 0.5 ? `${Math.round(modelParamsB * 1000)}M` : `${modelParamsB}B`} Params
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setTrainType("qlora")}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                        trainType === "qlora"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                          : "border-border/60 hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs">4-bit QLoRA</span>
                        <Badge variant="secondary" className="text-[9px] px-1 bg-emerald-500/10 text-emerald-400">
                          Recommended
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        ~{qloraRequiredVram} GB VRAM. Quantized NF4 for consumer & edge GPUs.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTrainType("lora")}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                        trainType === "lora"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                          : "border-border/60 hover:bg-muted/40"
                      }`}
                    >
                      <div className="font-semibold text-xs mb-1">Standard LoRA</div>
                      <p className="text-[11px] text-muted-foreground">
                        ~{loraRequiredVram} GB VRAM. 16-bit adapters for high precision.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTrainType("full")}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                        trainType === "full"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                          : "border-border/60 hover:bg-muted/40"
                      }`}
                    >
                      <div className="font-semibold text-xs mb-1">Full Fine-Tuning</div>
                      <p className="text-[11px] text-muted-foreground">
                        ~{fullRequiredVram} GB VRAM. Requires multi-GPU datacenter tier.
                      </p>
                    </button>
                  </div>

                  {/* Pre-Flight VRAM Fit Status Card */}
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 transition-colors ${
                      vramFitStatus === "fit"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : vramFitStatus === "insufficient"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">
                          Pre-Flight VRAM Check: {vramFitStatus === "fit" ? "VRAM Compatible" : vramFitStatus === "insufficient" ? "VRAM Incompatible" : "Awaiting Worker Fleet"}
                        </span>
                        <Badge
                          className={`text-[10px] uppercase font-mono ${
                            vramFitStatus === "fit"
                              ? "bg-emerald-600 text-white"
                              : vramFitStatus === "insufficient"
                              ? "bg-rose-600 text-white"
                              : "bg-amber-600 text-white"
                          }`}
                        >
                          {vramFitStatus}
                        </Badge>
                      </div>
                      <p className="text-[11px] opacity-90">{vramFitMessage}</p>
                      <div className="text-[10px] opacity-75 font-mono pt-1">
                        Formula: {trainType === "qlora" ? `~0.65 * ${modelParamsB} + 1.8 ≈ ${qloraRequiredVram} GB` : `~2.2 * ${modelParamsB} + 2.0 ≈ ${loraRequiredVram} GB`} | Fleet Max: {maxCollectiveVramGb.toFixed(1)} GB
                      </div>
                    </div>
                  </div>
                </div>

                {/* Training Material & Universal Parser */}
                <div className="space-y-3 rounded-lg border border-border/70 p-3.5 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold flex items-center gap-1.5">
                      <HardDrive className="h-4 w-4 text-primary" />
                      Training Material & Storage Mode
                    </Label>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-primary"
                        onClick={() => setIsByosModalOpen(true)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                        {byosConfig ? "BYOS Configured ✓" : "Configure BYOS S3/R2"}
                      </Button>
                    </div>
                  </div>

                  {/* Storage Mode Selector */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setStorageMode("tunnel_stream")}
                      className={`p-2 rounded border text-left text-xs cursor-pointer ${
                        storageMode === "tunnel_stream"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40 font-semibold"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      Zero-Setup Stream (RAM)
                    </button>
                    <button
                      type="button"
                      onClick={() => setStorageMode("byos_s3")}
                      className={`p-2 rounded border text-left text-xs cursor-pointer ${
                        storageMode === "byos_s3"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40 font-semibold"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      BYOS Cloudflare R2 / S3
                    </button>
                    <button
                      type="button"
                      onClick={() => setStorageMode("s3_url")}
                      className={`p-2 rounded border text-left text-xs cursor-pointer ${
                        storageMode === "s3_url"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40 font-semibold"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      Presigned S3 URL
                    </button>
                  </div>

                  {/* File Upload Drop Zone & Client Validator */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Universal Material (.jsonl, .json, .csv, .txt, .md)</span>
                      {parsedDataset && (
                        <button
                          type="button"
                          onClick={() => setIsPreviewModalOpen(true)}
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" />
                          Preview Records ({parsedDataset.totalRecords})
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Input
                        ref={fileInputRef}
                        type="file"
                        accept=".jsonl,.json,.csv,.tsv,.txt,.md"
                        onChange={handleDatasetFileUpload}
                        className="cursor-pointer file:cursor-pointer text-xs"
                      />
                    </div>

                    {isParsingDataset && (
                      <div className="text-xs text-muted-foreground flex items-center gap-2 py-1">
                        <RotateCw className="h-3.5 w-3.5 animate-spin text-primary" />
                        Validating and parsing dataset records in client memory...
                      </div>
                    )}

                    {parsedDataset && (
                      <div className="p-2.5 rounded bg-muted/40 border border-border/50 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileCheck className="h-4 w-4 text-emerald-400" />
                          <div>
                            <span className="font-semibold">{parsedDataset.formatDetected}</span>
                            <span className="text-muted-foreground ml-2">
                              • {parsedDataset.totalRecords.toLocaleString()} records • ~{parsedDataset.estimatedTotalTokens.toLocaleString()} tokens
                            </span>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                          Valid Schema
                        </Badge>
                      </div>
                    )}

                    {storageMode === "byos_s3" && (
                      <div className="space-y-1 pt-1">
                        <Label htmlFor="byosUploadUrl" className="text-xs">
                          Presigned R2 / S3 PUT URL (Optional Direct Upload)
                        </Label>
                        <Input
                          id="byosUploadUrl"
                          placeholder="https://<bucket>.r2.cloudflarestorage.com/dataset.jsonl?X-Amz-..."
                          value={byosUploadUrl}
                          onChange={(e) => setByosUploadUrl(e.target.value)}
                          className="font-mono text-xs"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          When provided with a local file, uploads directly from browser to your bucket (0 B sent to Oracle).
                        </p>
                      </div>
                    )}

                    {storageMode === "s3_url" && (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="datasetUrl" className="text-xs">Direct S3 URL</Label>
                          <button
                            type="button"
                            onClick={handleGenerateUploadUrl}
                            disabled={isGeneratingUpload}
                            className="text-[11px] text-primary hover:underline flex items-center gap-1"
                          >
                            <UploadCloud className="h-3 w-3" />
                            Generate Presigned URL
                          </button>
                        </div>
                        <Input
                          id="datasetUrl"
                          value={datasetUrl}
                          onChange={(e) => setDatasetUrl(e.target.value)}
                          className="font-mono text-xs"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Compute Strategy */}
                <div className="space-y-3 rounded-lg border border-border/70 p-3.5 bg-muted/20">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <Network className="h-4 w-4 text-primary" />
                      Autonomous Compute Topology
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className={`text-xs font-mono ${trainingReadyNodes.length > 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"}`}>
                        {trainingReadyNodes.length} Training GPU{trainingReadyNodes.length === 1 ? "" : "s"} Ready
                      </Badge>
                      {monitorOnlyNodes.length > 0 && (
                        <Badge variant="outline" className="text-[11px] font-mono bg-slate-500/10 text-slate-300 border-slate-500/30">
                          {monitorOnlyNodes.length} Inference/Monitor Only
                        </Badge>
                      )}
                    </div>
                  </div>
                  {monitorOnlyNodes.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Excluded from training automatically:{" "}
                      {monitorOnlyNodes.map((n) => `${n.name}${n.training_ready === false ? " (missing peft/deps)" : " (inference only)"}`).join(", ")}
                    </p>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setComputeStrategy("auto_swarm")}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer ${
                        computeStrategy === "auto_swarm"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40 font-semibold"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs">Auto-Swarm</span>
                        <Zap className="h-3 w-3 text-amber-400" />
                      </div>
                      <p className="text-[10px] text-muted-foreground">Dynamic multi-worker sharding.</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setComputeStrategy("ring_mesh")}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer ${
                        computeStrategy === "ring_mesh"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40 font-semibold"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <div className="text-xs mb-1">Collective Ring</div>
                      <p className="text-[10px] text-muted-foreground">Single-machine multi-GPU collective.</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setComputeStrategy("single")}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer ${
                        computeStrategy === "single"
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40 font-semibold"
                          : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      <div className="text-xs mb-1">Single Sovereign</div>
                      <p className="text-[10px] text-muted-foreground">Single dedicated GPU worker.</p>
                    </button>
                  </div>
                </div>

                {/* Hyperparameters */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="epochs" className="text-xs">Epochs</Label>
                    <Input
                      id="epochs"
                      type="number"
                      min="1"
                      max="100"
                      value={epochs}
                      onChange={(e) => setEpochs(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lr" className="text-xs">Learning Rate</Label>
                    <Input
                      id="lr"
                      type="text"
                      value={learningRate}
                      onChange={(e) => setLearningRate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="loraR" className="text-xs">LoRA Rank (r)</Label>
                    <Input
                      id="loraR"
                      type="number"
                      value={loraR}
                      onChange={(e) => setLoraR(e.target.value)}
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-3 border-t">
                  <Button type="button" variant="outline" onClick={() => setIsSubmitModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Sealing & Launching..." : "Launch Training Run"}
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
            <CardDescription>Completed Successfully</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-500">
              {jobs.filter((j) => j.status === "completed").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Training-Ready GPU VRAM</CardDescription>
            <CardTitle className="text-2xl font-bold font-mono text-primary">
              {totalOnlineVram.toFixed(1)} GB
            </CardTitle>
            {trainingReadyNodes.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {idleTrainingNodes.length} idle • {busyTrainingNodes.length} active
              </p>
            )}
          </CardHeader>
        </Card>
      </div>

      {/* Main Jobs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Training Runs & Telemetry
          </CardTitle>
          <CardDescription>
            Real-time loss telemetry, live checkpoint validation, and local browser-based .safetensors decryption
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
              <p>No training jobs launched yet. Click "Launch Training Run" to begin fine-tuning.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                  <tr>
                    <th className="py-3 px-4">Job Name</th>
                    <th className="py-3 px-4">Model & Method</th>
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
                        <div>{job.name || "Untitled Run"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{job.id.slice(0, 13)}...</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold">{job.base_model}</div>
                        <div className="text-xs text-muted-foreground uppercase">
                          {job.train_type} • {job.parallelism}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {job.current_epoch} / {job.total_epochs}
                      </td>
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div>{getStatusBadge(job.status)}</div>
                          {(job.status === "running" || job.status === "queued") && job.training_phase?.detail && (
                            <div className="text-[11px] text-muted-foreground max-w-[260px] truncate" title={job.training_phase.detail}>
                              {job.training_phase.detail}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline">{job.checkpoints?.length || 0} saved</Badge>
                      </td>
                      <td className="py-3 px-4 font-mono">${(job.cost || 0).toFixed(4)}</td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {job.status === "completed" && (
                          <Button
                            variant="default"
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                            disabled={isDecryptingJobId === job.id}
                            onClick={() => handleDecryptAndDownload(job)}
                          >
                            {isDecryptingJobId === job.id ? (
                              <RotateCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Unlock className="h-3.5 w-3.5" />
                            )}
                            Decrypt & Download .safetensors
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => openTelemetry(job)}>
                          Telemetry
                        </Button>
                        {["queued", "running"].includes(job.status) && (
                          <Button variant="destructive" size="sm" onClick={() => handleCancelJob(job.id)}>
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

      {/* Dataset Preview Modal */}
      <Dialog open={isPreviewModalOpen} onOpenChange={setIsPreviewModalOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5 text-primary" />
              Universal Dataset Preview: {parsedDataset?.formatDetected}
            </DialogTitle>
            <DialogDescription>
              Showing parsed records, estimated token counts, and normalized training prompt structures
            </DialogDescription>
          </DialogHeader>

          {parsedDataset && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-3 gap-3 p-3 bg-muted/30 rounded border text-center text-xs">
                <div>
                  <div className="text-muted-foreground">Total Samples</div>
                  <div className="text-lg font-bold">{parsedDataset.totalRecords.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Est. Total Tokens</div>
                  <div className="text-lg font-bold font-mono text-primary">
                    ~{parsedDataset.estimatedTotalTokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Source Format</div>
                  <div className="text-lg font-bold">{parsedDataset.formatDetected}</div>
                </div>
              </div>

              <div className="border rounded overflow-x-auto max-h-[50vh]">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted font-semibold sticky top-0">
                    <tr>
                      <th className="py-2 px-3 w-12">#</th>
                      <th className="py-2 px-3 w-48">Instruction / Prompt</th>
                      <th className="py-2 px-3">Input / Context</th>
                      <th className="py-2 px-3">Response / Completion</th>
                      <th className="py-2 px-3 w-20 text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {parsedDataset.sampleRecords.map((sample) => (
                      <tr key={sample.id} className="hover:bg-muted/20">
                        <td className="py-2 px-3 font-mono text-muted-foreground">{sample.id}</td>
                        <td className="py-2 px-3 font-medium line-clamp-2 max-w-xs">{sample.instruction}</td>
                        <td className="py-2 px-3 text-muted-foreground line-clamp-2 max-w-xs">{sample.input || "—"}</td>
                        <td className="py-2 px-3 text-emerald-600 line-clamp-2 max-w-sm">{sample.response}</td>
                        <td className="py-2 px-3 text-right font-mono text-muted-foreground">~{sample.estimatedTokens}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* BYOS Settings Modal */}
      <Dialog open={isByosModalOpen} onOpenChange={setIsByosModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              BYOS Storage Settings (Cloudflare R2 / S3)
            </DialogTitle>
            <DialogDescription>
              Stored strictly in your browser localStorage. Credentials are never stored or logged on Oracle coordinator servers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-3">
            <div className="space-y-1">
              <Label className="text-xs">Storage Provider</Label>
              <select
                className="w-full h-8 rounded border text-xs px-2 bg-transparent"
                value={byosConfig?.provider || "cloudflare_r2"}
                onChange={(e) =>
                  setByosConfig({
                    provider: e.target.value as any,
                    endpoint: byosConfig?.endpoint || "",
                    bucket: byosConfig?.bucket || "",
                    region: byosConfig?.region || "auto",
                    accessKeyId: byosConfig?.accessKeyId || "",
                    secretAccessKey: byosConfig?.secretAccessKey || "",
                  })
                }
              >
                <option value="cloudflare_r2">Cloudflare R2 ($0 Egress)</option>
                <option value="aws_s3">AWS S3</option>
                <option value="custom_s3">Custom S3 Compatible</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Endpoint URL</Label>
              <Input
                placeholder="https://<account_id>.r2.cloudflarestorage.com"
                value={byosConfig?.endpoint || ""}
                onChange={(e) => setByosConfig({ ...(byosConfig as any), endpoint: e.target.value })}
                className="text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Bucket Name</Label>
                <Input
                  placeholder="my-training-bucket"
                  value={byosConfig?.bucket || ""}
                  onChange={(e) => setByosConfig({ ...(byosConfig as any), bucket: e.target.value })}
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Region</Label>
                <Input
                  placeholder="auto or us-east-1"
                  value={byosConfig?.region || "auto"}
                  onChange={(e) => setByosConfig({ ...(byosConfig as any), region: e.target.value })}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Access Key ID</Label>
              <Input
                placeholder="R2 / S3 Access Key"
                value={byosConfig?.accessKeyId || ""}
                onChange={(e) => setByosConfig({ ...(byosConfig as any), accessKeyId: e.target.value })}
                className="text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Secret Access Key</Label>
              <Input
                type="password"
                placeholder="R2 / S3 Secret Key"
                value={byosConfig?.secretAccessKey || ""}
                onChange={(e) => setByosConfig({ ...(byosConfig as any), secretAccessKey: e.target.value })}
                className="text-xs font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setByosConfig(null);
                  localStorage.removeItem("nebula_byos_config_v1");
                  setIsByosModalOpen(false);
                  toast.info("Cleared BYOS configuration");
                }}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (byosConfig) {
                    saveByosConfig(byosConfig);
                    toast.success("Saved BYOS config to client localStorage");
                  }
                  setIsByosModalOpen(false);
                }}
              >
                Save to Local Storage
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Key Recovery Modal */}
      <Dialog open={keyRecoveryModalOpen} onOpenChange={setKeyRecoveryModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              Provide DEK to Decrypt .safetensors
            </DialogTitle>
            <DialogDescription>
              Job was encrypted with client-side Zero-Storage cryptography. Upload your downloaded <span className="font-mono">.nebulakey</span> file or paste your base64 DEK.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-3">
            <div className="space-y-1">
              <Label className="text-xs">Upload .nebulakey File</Label>
              <Input
                type="file"
                accept=".nebulakey,.json"
                onChange={handleNebulaKeyFileUpload}
                className="text-xs cursor-pointer"
              />
            </div>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-border"></div>
              <span className="flex-shrink mx-2 text-[10px] text-muted-foreground uppercase">Or paste key</span>
              <div className="flex-grow border-t border-border"></div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Base64 Data Encryption Key (DEK)</Label>
              <Input
                placeholder="Paste 32-byte Base64 key..."
                value={manualDekInput}
                onChange={(e) => setManualDekInput(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setKeyRecoveryModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!manualDekInput.trim() || !keyRecoveryTargetJob}
                onClick={() => {
                  if (keyRecoveryTargetJob && manualDekInput.trim()) {
                    executeDecryptSafetensors(keyRecoveryTargetJob, manualDekInput.trim());
                  }
                }}
              >
                Decrypt Adapter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Telemetry & Checkpoints Modal */}
      <Dialog open={isTelemetryModalOpen} onOpenChange={setIsTelemetryModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              Training Telemetry: {selectedJob?.name || selectedJob?.id}
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
                  <div className="text-xl font-bold">
                    {selectedJob.current_epoch} / {selectedJob.total_epochs}
                  </div>
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

              {(selectedJob.status === "running" || selectedJob.status === "queued") && selectedJob.training_phase?.detail && (
                <div className="p-3 rounded-lg border border-sky-500/30 bg-sky-500/10 text-xs text-sky-300 space-y-1.5">
                  <div className="flex items-center justify-between font-medium">
                    <span>Worker Phase: {selectedJob.training_phase.phase}</span>
                    {typeof selectedJob.training_phase.progress_pct === "number" && (
                      <span className="font-mono">{selectedJob.training_phase.progress_pct.toFixed(1)}%</span>
                    )}
                  </div>
                  <div className="text-[11px] opacity-90">{selectedJob.training_phase.detail}</div>
                  {typeof selectedJob.training_phase.progress_pct === "number" && (
                    <div className="w-full h-1.5 bg-sky-950/60 rounded overflow-hidden">
                      <div
                        className="h-full bg-sky-400 transition-all"
                        style={{ width: `${Math.max(2, Math.min(100, selectedJob.training_phase.progress_pct))}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

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
                            <td className="py-2 px-3 text-muted-foreground">
                              {new Date(step.timestamp).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Checkpoints & Download Links */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    Saved LoRA Checkpoints (.safetensors)
                  </span>
                  {selectedJob.status === "completed" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                      onClick={() => handleDecryptAndDownload(selectedJob)}
                    >
                      <Unlock className="h-3 w-3" />
                      Decrypt & Download Local .safetensors
                    </Button>
                  )}
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
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs gap-1"
                            onClick={() => {
                              const dek = getJobDek(selectedJob.id);
                              if (dek) {
                                exportNebulaKey(selectedJob.id, dek, { model_id: selectedJob.base_model });
                              } else {
                                toast.info("No stored DEK found for this job; enter key to export.");
                              }
                            }}
                          >
                            <Key className="h-3 w-3" />
                            Export .nebulakey
                          </Button>
                          <Button
                            size="sm"
                            disabled={isDecryptingJobId === selectedJob.id}
                            className="text-xs gap-1.5"
                            onClick={() => handleDownloadRawCheckpoint(selectedJob, ckpt.epoch, ckpt.s3_url)}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Raw Checkpoint
                          </Button>
                        </div>
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
