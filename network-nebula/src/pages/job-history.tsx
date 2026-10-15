import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  ImageIcon,
  RefreshCw,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { taskService } from "@/services/api/tasks";
import type { Task } from "@/types";

function getStatusIcon(status: string) {
  switch (status.toLowerCase()) {
    case "pending":
    case "queued":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case "processing":
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case "completed":
    case "success":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status.toLowerCase()) {
    case "pending":
    case "queued":
      return "secondary";
    case "processing":
      return "outline";
    case "completed":
    case "success":
      return "default";
    case "failed":
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

interface TaskResult {
  image_url?: string;
  prompt?: string;
}

export function JobHistoryPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const response = await taskService.list();
        setJobs(response.tasks);
        setIsPolling(response.tasks.some((job) => job.status === "pending" || job.status === "processing"));
      } catch (err) {
        toast.error("Failed to load job history");
      } finally {
        setIsLoading(false);
      }
    };

    fetchJobs();
  }, []);

  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(async () => {
      try {
        const response = await taskService.list();
        setJobs(response.tasks);
        const stillPolling = response.tasks.some((job) => job.status === "pending" || job.status === "processing");
        setIsPolling(stillPolling);
      } catch {
        // Silently handle polling errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isPolling]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="inline-block h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading job history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="container mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Job History</h1>
            <p className="text-muted-foreground mt-1">View your image generation jobs</p>
          </div>
          <Button onClick={() => navigate("/create-job")} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            New Job
          </Button>
        </div>

        {jobs.length === 0 ? (
          <EmptyState
            icon={<ImageIcon className="h-12 w-12" />}
            title="No jobs yet"
            description="Create your first image generation job to get started."
            action={{
              label: "Create Job",
              onClick: () => navigate("/create-job"),
            }}
          />
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const result = job.result as TaskResult | undefined;
              return (
                <Card key={job.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-muted p-2">
                          {result?.image_url ? (
                            <Eye className="h-5 w-5" />
                          ) : (
                            getStatusIcon(job.status)
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-mono text-sm font-medium">{job.id.slice(0, 8)}</p>
                            <Badge variant={getStatusBadgeVariant(job.status)}>
                              {job.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                            {result?.prompt || "No prompt"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Created {new Date(job.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {result?.image_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate("/job-status/" + job.id)}
                          >
                            View
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate("/job-status/" + job.id)}
                        >
                          Details
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
