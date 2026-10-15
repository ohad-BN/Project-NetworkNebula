import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  Loader2,
  XCircle,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { workersService } from "@/services/api/workers";
import type { WorkerStats } from "@/types";

interface CurrentTask {
  taskId: string;
  taskType: string;
  progress: number;
  earnings: number;
  startedAt: string;
}

function NodeStatusIndicator({
  workerId,
  isOnline,
}: {
  workerId: string;
  isOnline: boolean;
}) {
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);

  useEffect(() => {
    if (!isOnline || !workerId) return;

    const sendHeartbeat = async () => {
      try {
        await workersService.heartbeat(workerId);
        setLastHeartbeat(new Date());
      } catch {
        // Silently handle heartbeat errors
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 30000);

    return () => clearInterval(interval);
  }, [workerId, isOnline]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Node Status
        </CardTitle>
        <CardDescription>Your worker's connection status</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
            ) : (
              <span className="relative flex h-3 w-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
            )}
            <span className="font-medium">{isOnline ? "Online" : "Offline"}</span>
          </div>
          <Badge variant={isOnline ? "default" : "destructive"}>
            {isOnline ? "Connected" : "Disconnected"}
          </Badge>
        </div>

        {lastHeartbeat && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Last heartbeat: {lastHeartbeat.toLocaleTimeString()}</span>
          </div>
        )}

        <div className="pt-2">
          <p className="text-xs text-muted-foreground mb-1">Worker ID</p>
          <p className="font-mono text-sm bg-muted p-2 rounded">{workerId}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CurrentTaskPanel({ task }: { task: CurrentTask | null }) {
  if (!task) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Current Task
          </CardTitle>
          <CardDescription>Task you are currently working on</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">No active task</p>
            <p className="text-sm text-muted-foreground mt-1">
              Waiting for tasks to be assigned
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Current Task
        </CardTitle>
        <CardDescription>Task you are currently working on</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{task.taskType}</span>
            <Badge variant="outline">{task.taskId.slice(0, 8)}</Badge>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{task.progress}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Started {task.startedAt}</span>
            </div>
            <div className="flex items-center gap-1 text-sm font-medium text-green-600">
              <DollarSign className="h-4 w-4" />
              <span>+${task.earnings.toFixed(4)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EarningsSummaryCard({ stats }: { stats: WorkerStats | null }) {
  const todayEarnings = stats?.earnings || 0;
  const pendingPayout = todayEarnings * 0.8;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Earnings Summary
        </CardTitle>
        <CardDescription>Your earnings and payout status</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Today's Earnings</p>
            <div className="flex items-center gap-1">
              <DollarSign className="h-4 w-4 text-green-600" />
              <span className="text-xl font-bold">${todayEarnings.toFixed(2)}</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Pending Payout</p>
            <div className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4 text-yellow-600" />
              <span className="text-xl font-bold">${pendingPayout.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {stats && (
          <div className="pt-4 border-t space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Tasks</span>
              <span className="font-medium">{stats.total_tasks}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Completed</span>
              <span className="font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                {stats.completed_tasks}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Failed</span>
              <span className="font-medium flex items-center gap-1">
                <XCircle className="h-3 w-3 text-red-500" />
                {stats.failed_tasks}
              </span>
            </div>
          </div>
        )}

        <Link to="/worker/earnings" className="block pt-2">
          <Button variant="outline" className="w-full">
            View Earnings History
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export function WorkerDashboardPage() {
  const [workerId] = useState<string>("worker-demo-12345");
  const [isOnline] = useState(true);
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [currentTask] = useState<CurrentTask | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await workersService.stats(workerId);
        setStats(data);
      } catch {
        setStats({
          worker_id: workerId,
          total_tasks: 47,
          completed_tasks: 45,
          failed_tasks: 2,
          earnings: 127.5,
          uptime_seconds: 86400,
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadStats();
  }, [workerId]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="inline-block h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Worker Dashboard</h1>
            <p className="text-sm text-muted-foreground">Monitor your worker's performance</p>
          </div>
          <Link to="/worker/register">
            <Button variant="outline" size="sm">
              Register New Worker
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <NodeStatusIndicator workerId={workerId} isOnline={isOnline} />
          <CurrentTaskPanel task={currentTask} />
          <EarningsSummaryCard stats={stats} />
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link to="/worker/earnings" className="block">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-primary/10 p-3">
                    <DollarSign className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Earnings</p>
                    <p className="text-sm text-muted-foreground">View transactions</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/worker/tasks" className="block">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-primary/10 p-3">
                    <Activity className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Task History</p>
                    <p className="text-sm text-muted-foreground">View past tasks</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/worker/settings" className="block">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-primary/10 p-3">
                    <Cpu className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Settings</p>
                    <p className="text-sm text-muted-foreground">Configure worker</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  );
}
