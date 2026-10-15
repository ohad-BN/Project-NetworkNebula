import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Clock, CheckCircle, XCircle, Loader2, Download, Share2, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { LoadingSpinner } from '@/components/common/loading-spinner';
import { ImagePreview } from '@/components/common/image-preview';
import { EmptyState } from '@/components/common/empty-state';
import { taskService } from '@/services/api/tasks';
import type { TaskStatus } from '@/types/index';

const RATE_PER_MEGAPIXEL_STEP = 0.001;

export function JobStatusPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTerminalStatus = task?.status === 'completed' || task?.status === 'failed';

  const fetchTaskStatus = useCallback(async () => {
    if (!taskId) return;
    try {
      const response = await taskService.status(taskId);
      setTask(response);
      setError(null);
      if (response.status === 'completed' || response.status === 'failed') {
        setIsPolling(false);
        if (response.status === 'failed') {
          toast.error((response.result as { error?: string })?.error || 'Job failed');
        } else {
          toast.success('Image generation complete!');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        setError('Task not found');
        setIsPolling(false);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch task status');
      }
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) {
      setError('No task ID provided');
      setIsLoading(false);
      return;
    }
    fetchTaskStatus();
  }, [taskId, fetchTaskStatus]);

  useEffect(() => {
    if (!isTerminalStatus && taskId) {
      setIsPolling(true);
      const interval = setInterval(fetchTaskStatus, 3000);
      return () => {
        clearInterval(interval);
        setIsPolling(false);
      };
    }
  }, [isTerminalStatus, taskId, fetchTaskStatus]);

  const rawTask = task as (TaskStatus & { output_url?: string }) | null;
  const taskOutput = rawTask?.result as { width?: number; height?: number; steps?: number; image_url?: string; prompt?: string } | null;
  const imageUrl = taskOutput?.image_url || rawTask?.output_url || (rawTask?.result as { output_url?: string } | null)?.output_url;

  const handleDownload = () => {
    if (imageUrl) {
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = 'generated-' + taskId + '.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleShare = async () => {
    if (imageUrl) {
      try {
        await navigator.clipboard.writeText(imageUrl);
        toast.success('Image URL copied to clipboard!');
      } catch {
        toast.error('Failed to copy URL');
      }
    }
  };

  const handleRegenerate = () => {
    const resultOutput = task?.result as { prompt?: string } | null;
    const prompt = resultOutput?.prompt;
    if (prompt) {
      navigate('/create-job?prompt=' + encodeURIComponent(prompt));
    } else {
      navigate('/create-job');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading task status..." />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="container mx-auto max-w-3xl">
          <EmptyState
            icon={<XCircle className="h-12 w-12 text-destructive" />}
            title={error || 'Task not found'}
            description="The task you are looking for does not exist or has been removed."
            action={{
              label: 'Go Back',
              onClick: () => navigate(-1),
            }}
          />
        </div>
      </div>
    );
  }

  const width = taskOutput?.width || 512;
  const height = taskOutput?.height || 512;
  const steps = taskOutput?.steps || 20;
  const megapixels = (width * height) / 1000000;
  const cost = RATE_PER_MEGAPIXEL_STEP * megapixels * steps;

  const getStatusIcon = () => {
    switch (task.status) {
      case 'pending':
        return <Clock className="h-5 w-5" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-5 w-5" />;
      case 'failed':
        return <XCircle className="h-5 w-5" />;
      default:
        return <Clock className="h-5 w-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="container mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Job Status</h1>
            <p className="text-sm text-muted-foreground">Task ID: {taskId}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {getStatusIcon()}
                <span>Status</span>
              </CardTitle>
              <StatusBadge status={task.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Resolution</p>
                <p className="font-medium">{width} x {height}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Steps</p>
                <p className="font-medium">{steps}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Megapixels</p>
                <p className="font-medium">{megapixels.toFixed(2)} MP</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Estimated Cost</p>
                <p className="font-medium text-primary">${cost.toFixed(4)}</p>
              </div>
            </div>
            {isPolling && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Polling for updates...</span>
              </div>
            )}
          </CardContent>
        </Card>

        {task.status === 'completed' && imageUrl && (
          <Card>
            <CardHeader>
              <CardTitle>Generated Image</CardTitle>
              <CardDescription>Your generated image is ready</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ImagePreview
                src={imageUrl}
                alt="Generated image"
                className="w-full rounded-lg border"
              />
              <div className="flex gap-2">
                <Button onClick={handleDownload} className="flex-1 gap-2">
                  <Download className="h-4 w-4" />
                  Download
                </Button>
                <Button variant="outline" onClick={handleShare} className="flex-1 gap-2">
                  <Share2 className="h-4 w-4" />
                  Share
                </Button>
                <Button variant="outline" onClick={handleRegenerate} className="flex-1 gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Regenerate
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {task.status === 'failed' && (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                Job Failed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {(task.result as { error?: string })?.error || 'An unknown error occurred'}
              </p>
              <Button variant="outline" onClick={handleRegenerate} className="mt-4 gap-2">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}

        {taskOutput?.prompt && (
          <Card>
            <CardHeader>
              <CardTitle>Prompt</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{taskOutput.prompt}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
