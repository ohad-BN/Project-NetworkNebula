export interface WorkerCapabilityLike {
  status?: string;
  is_available?: boolean;
  training_ready?: boolean;
  supported_task_types?: string | string[] | null;
}

/**
 * Determine whether a worker node can participate in LoRA/QLoRA training workloads.
 * Requires active availability (`online`, or `busy` when `allowBusy` is enabled),
 * verified ML training dependencies (`training_ready !== false`),
 * and `training` or `distributed_training` in `supported_task_types`.
 */
export function isWorkerTrainingCapable(
  node: WorkerCapabilityLike,
  options?: { allowBusy?: boolean },
): boolean {
  const allowBusy = options?.allowBusy ?? true;
  const st = String(node.status || "").trim().toLowerCase();
  if (st && st !== "online" && !(allowBusy && st === "busy")) return false;
  if (node.is_available === false) return false;
  if (node.training_ready === false) return false;

  const raw = node.supported_task_types;
  const tasks = Array.isArray(raw)
    ? raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : String(raw || "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

  if (tasks.length === 0) return true;
  return tasks.includes("training") || tasks.includes("distributed_training");
}
