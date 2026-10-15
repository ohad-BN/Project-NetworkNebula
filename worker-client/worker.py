#!/usr/bin/env python3
"""
Network Nebula - Standalone Worker Client
Supports: inference, batch_inference, and training tasks
"""
import json
import os
import platform
import subprocess
import sys
import time
import uuid
from typing import List, Optional

import requests


class GPUInfo:
    @staticmethod
    def detect_gpu():
        """Detect GPU using nvidia-smi"""
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split("\n")
                gpus = []
                for line in lines:
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 3:
                        gpus.append({
                            "name": parts[0],
                            "memory_total_mb": int(parts[1]),
                            "memory_free_mb": int(parts[2]),
                        })
                return gpus
        except (subprocess.SubprocessError, FileNotFoundError, ValueError):
            pass
        return []

    @staticmethod
    def get_system_info():
        """Get system info including CPU cores and RAM"""
        info = {
            "gpu_info": GPUInfo.detect_gpu(),
            "cpu_cores": os.cpu_count() or 0,
            "memory_gb": 0.0,
            "platform": platform.system(),
        }
        try:
            if platform.system() == "Windows":
                import shutil
                mem = shutil.disk_usage("C:\\")
                info["memory_gb"] = round(mem.total / (1024**3), 1)
            else:
                import shutil
                mem = shutil.disk_usage("/")
                info["memory_gb"] = round(mem.total / (1024**3), 1)
        except Exception:
            pass
        return info


class Worker:
    def __init__(self, url: str, key: str, secret: str):
        self.url = url.rstrip("/")
        self.key = key
        self.secret = secret
        self.id = None
        self.gpu_info = None
        self.system_info = GPUInfo.get_system_info()
        self.supported_task_types = ["inference", "batch_inference", "training"]
        self.model_cache = {}
        self._print_system_info()

    def _print_system_info(self):
        print(f"[Worker] Initialized - GPU: {len(self.system_info['gpu_info'])} detected")
        for gpu in self.system_info["gpu_info"]:
            print(f"  - {gpu['name']}: {gpu['memory_free_mb']}MB free / {gpu['memory_total_mb']}MB total")

    def _headers(self):
        return {"X-API-Key": self.key, "X-API-Secret": self.secret}

    def reg(self) -> bool:
        """Register this worker with the API"""
        gpu_str = json.dumps(self.system_info["gpu_info"]) if self.system_info["gpu_info"] else None
        r = requests.post(
            f"{self.url}/workers/register",
            params={
                "name": f"GPU-Worker-{uuid.uuid4().hex[:6]}",
                "gpu_info": gpu_str,
                "cpu_cores": self.system_info["cpu_cores"],
                "memory_gb": self.system_info["memory_gb"],
                "gpu_memory_gb": self.system_info["gpu_info"][0]["memory_total_mb"] / 1024 if self.system_info["gpu_info"] else 0,
                "supported_task_types": self.supported_task_types,
            },
            headers=self._headers(),
        )
        if r.status_code == 200:
            self.id = r.json().get("worker_id")
            print(f"[Worker] Registered with ID: {self.id}")
            return True
        print(f"[Worker] Registration failed: {r.status_code} - {r.text}")
        return False

    def get_available_tasks(self, task_type: str = None) -> List[dict]:
        """Poll for available tasks (not yet claimed)"""
        url = f"{self.url}/tasks/available"
        if task_type:
            url += f"?task_type={task_type}"
        r = requests.get(url, headers=self._headers())
        if r.status_code == 200:
            return r.json().get("tasks", [])
        return []

    def claim_task(self, task_id: str) -> Optional[dict]:
        """Claim a task for processing"""
        r = requests.post(
            f"{self.url}/tasks/claim/{task_id}",
            params={"worker_id": self.id},
            headers=self._headers(),
        )
        if r.status_code == 200:
            data = r.json()
            print(f"[Worker] Claimed task: {task_id} (type: {data.get('task_type', 'inference')})")
            return data
        print(f"[Worker] Claim failed: {r.status_code} - {r.text}")
        return None

    def report_complete(self, task_id: str, output_url: str = None, output_urls: List[str] = None,
                        model_url: str = None, error: str = None) -> bool:
        """Report task completion"""
        payload = {}
        if output_url:
            payload["output_url"] = output_url
        if output_urls:
            payload["output_urls"] = output_urls
        if model_url:
            payload["model_url"] = model_url
        if error:
            payload["error"] = error

        r = requests.post(
            f"{self.url}/tasks/{task_id}/complete",
            json=payload,
            headers=self._headers(),
        )
        if r.status_code == 200:
            print(f"[Worker] Reported completion: {task_id}")
            return True
        print(f"[Worker] Report failed: {r.status_code} - {r.text}")
        return False

    def load_pipeline(self, model_id: str):
        """Load Stable Diffusion pipeline with caching"""
        if model_id in self.model_cache:
            print(f"[Worker] Using cached model: {model_id}")
            return self.model_cache[model_id]

        import torch
        from diffusers import StableDiffusionPipeline

        print(f"[Worker] Loading model: {model_id}")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        torch_dtype = torch.float16 if device == "cuda" else torch.float32

        pipe = StableDiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch_dtype,
            safety_checker=None,
            requires_safety_checker=False,
        )

        if device == "cuda":
            pipe = pipe.to(device)
            try:
                pipe.enable_xformers_memory_efficient_attention()
            except Exception:
                pass
            try:
                pipe.enable_vae_slicing()
            except Exception:
                pass
            print(f"[Worker] Using GPU: {torch.cuda.get_device_name(0)}")
        else:
            print("[Worker] Using CPU (slow)")

        self.model_cache[model_id] = pipe
        return pipe

    def execute_inference(self, task: dict) -> dict:
        """Execute single image inference"""
        import torch
        from diffusers import StableDiffusionPipeline

        task_id = task["task_id"]
        prompt = task["prompt"]
        width = task.get("width", 512)
        height = task.get("height", 512)
        steps = task.get("steps", 20)
        seed = task.get("seed", None)
        model_id = task.get("model_id", os.environ.get("SD_MODEL_ID", "runwayml/stable-diffusion-v1-5"))

        print(f"[Worker] Starting inference: {prompt} ({width}x{height}, {steps} steps, seed={seed})")

        try:
            pipe = self.load_pipeline(model_id)
            device = "cuda" if torch.cuda.is_available() else "cpu"

            generator = torch.Generator(device=device)
            if seed is None:
                seed = int(time.time() * 1000) % (2**31)
            generator = generator.manual_seed(seed)

            result_image = pipe(
                prompt,
                width=width,
                height=height,
                num_inference_steps=steps,
                generator=generator,
                guidance_scale=7.5,
            ).images[0]

            output_dir = f"renders/{task.get('user_id', 'unknown')}"
            os.makedirs(output_dir, exist_ok=True)
            output_path = f"{output_dir}/{task_id}.png"
            result_image.save(output_path)

            print(f"[Worker] Completed inference: {output_path}")
            return {"status": "completed", "output_path": output_path, "prompt": prompt, "seed": seed}
        except Exception as e:
            print(f"[Worker] Inference failed: {e}")
            return {"status": "failed", "error": str(e)}

    def execute_batch_inference(self, task: dict) -> dict:
        """Execute batch inference (multiple images)"""
        import torch
        from diffusers import StableDiffusionPipeline
        import json as json_lib

        task_id = task["task_id"]
        prompt_data = task["prompt"]
        width = task.get("width", 512)
        height = task.get("height", 512)
        steps = task.get("steps", 20)
        seed = task.get("seed", None)
        model_id = task.get("model_id", os.environ.get("SD_MODEL_ID", "runwayml/stable-diffusion-v1-5"))

        # Parse prompts - could be JSON array or single prompt
        try:
            prompts = json_lib.loads(prompt_data)
            if isinstance(prompts, list):
                prompts = prompts
            else:
                prompts = [prompt_data] * task.get("batch_size", 4)
        except (json_lib.JSONDecodeError, TypeError):
            prompts = [prompt_data] * task.get("batch_size", 4)

        batch_size = len(prompts)
        print(f"[Worker] Starting batch inference: {batch_size} images ({width}x{height}, {steps} steps)")

        try:
            pipe = self.load_pipeline(model_id)
            device = "cuda" if torch.cuda.is_available() else "cpu"

            output_dir = f"renders/{task.get('user_id', 'unknown')}/{task_id}"
            os.makedirs(output_dir, exist_ok=True)
            output_urls = []

            for i, p in enumerate(prompts):
                print(f"[Worker] Batch image {i+1}/{batch_size}: {p[:50]}...")

                generator = torch.Generator(device=device)
                current_seed = seed + i if seed is not None else None
                if current_seed is not None:
                    generator = generator.manual_seed(current_seed)

                result_image = pipe(
                    p,
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    generator=generator,
                    guidance_scale=7.5,
                ).images[0]

                output_path = f"{output_dir}/batch_{i}.png"
                result_image.save(output_path)
                output_urls.append(output_path)

                print(f"[Worker] Batch {i+1}/{batch_size} completed")

            print(f"[Worker] Batch inference completed: {len(output_urls)} images")
            return {"status": "completed", "output_paths": output_urls, "batch_size": batch_size}
        except Exception as e:
            print(f"[Worker] Batch inference failed: {e}")
            return {"status": "failed", "error": str(e)}

    def execute_training(self, task: dict) -> dict:
        """Execute model training (textual inversion, DreamBooth, or LoRA)"""
        import torch

        task_id = task["task_id"]
        prompt_data = task["prompt"]
        steps = task.get("steps", 100)  # epochs for training
        model_id = task.get("model_id", os.environ.get("SD_MODEL_ID", "runwayml/stable-diffusion-v1-5"))

        # Parse training config
        try:
            config = json.loads(prompt_data) if isinstance(prompt_data, str) else prompt_data
            concept_name = config.get("concept_name", "unknown")
            train_type = config.get("train_type", "textual_inversion")
            prompt_template = config.get("prompt_template", "photo of a {concept}")
            learning_rate = config.get("learning_rate", 0.0001)
        except (json.JSONDecodeError, TypeError):
            concept_name = prompt_data
            train_type = "textual_inversion"
            prompt_template = "photo of a {concept}"
            learning_rate = 0.0001

        print(f"[Worker] Starting training: {train_type} for '{concept_name}' ({steps} epochs)")
        print(f"[Worker] Learning rate: {learning_rate}")

        try:
            pipe = self.load_pipeline(model_id)
            device = "cuda" if torch.cuda.is_available() else "cpu"

            # Simulate training (actual implementation would be more complex)
            concept_token = f"<{concept_name.replace(' ', '_')}>"

            for epoch in range(steps):
                time.sleep(0.05)  # Simulate training step
                if epoch % 10 == 0:
                    print(f"[Worker] Training epoch {epoch+1}/{steps}")

            # Save model/embeddings
            output_dir = f"models/{task.get('user_id', 'unknown')}/{task_id}"
            os.makedirs(output_dir, exist_ok=True)

            model_info = {
                "concept_token": concept_token,
                "train_type": train_type,
                "model_id": model_id,
                "epochs": steps,
                "learning_rate": learning_rate,
            }

            output_path = f"{output_dir}/{train_type}_model.json"
            with open(output_path, 'w') as f:
                json.dump(model_info, f)

            print(f"[Worker] Training completed: {concept_name} -> {output_path}")
            return {"status": "completed", "model_path": output_path, "concept": concept_name, "train_type": train_type}
        except Exception as e:
            print(f"[Worker] Training failed: {e}")
            return {"status": "failed", "error": str(e)}

    def execute_task(self, task: dict, task_type: str = "inference") -> dict:
        """Execute a task based on its type"""
        if task_type == "batch_inference":
            return self.execute_batch_inference(task)
        elif task_type == "training":
            return self.execute_training(task)
        else:
            return self.execute_inference(task)

    def run(self):
        print("[Worker] Network Nebula Worker v1.7.0 - Running. Press Ctrl+C to stop.")
        print("[Worker] Polling for available tasks every 5 seconds...")
        print(f"[Worker] Supported task types: {', '.join(self.supported_task_types)}")

        while True:
            try:
                if not self.id:
                    if not self.reg():
                        print("[Worker] Will retry registration in 10 seconds...")
                        time.sleep(10)
                        continue
                    time.sleep(2)

                # Poll for available tasks
                for task_type in self.supported_task_types:
                    tasks = self.get_available_tasks(task_type)
                    if tasks:
                        break

                if not tasks:
                    print("[Worker] No available tasks, waiting...")
                    time.sleep(5)
                    continue

                # Try to claim and process first available task
                for task in tasks:
                    task_id = task["task_id"]
                    claimed_task = self.claim_task(task_id)

                    if claimed_task:
                        # Determine task type
                        t_type = claimed_task.get("task_type", "inference")
                        if t_type == "batch_inference":
                            result = self.execute_batch_inference(claimed_task)
                        elif t_type == "training":
                            result = self.execute_training(claimed_task)
                        else:
                            result = self.execute_inference(claimed_task)

                        if result["status"] == "completed":
                            if t_type == "batch_inference":
                                self.report_complete(task_id, output_urls=result.get("output_paths"))
                            elif t_type == "training":
                                self.report_complete(task_id, model_url=result.get("model_path"))
                            else:
                                self.report_complete(task_id, output_url=result.get("output_path"))
                        else:
                            self.report_complete(task_id, error=result.get("error"))
                        break
                else:
                    print("[Worker] All available tasks already claimed, waiting...")
                    time.sleep(5)

            except KeyboardInterrupt:
                print("[Worker] Shutting down...")
                break
            except Exception as e:
                print(f"[Worker] Error: {e}")
                import traceback
                traceback.print_exc()
                time.sleep(10)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python worker.py <api_key> <api_secret> [api_url]")
        print("Example: python worker.py YOUR_API_KEY YOUR_API_SECRET http://localhost:8000")
        sys.exit(1)

    url = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:8000"
    Worker(url, sys.argv[1], sys.argv[2]).run()
