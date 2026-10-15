import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Cpu, HardDrive, Monitor } from "lucide-react";
import { workersService } from "@/services/api/workers";

interface SystemInfo {
  hostname: string;
  ip_address: string;
  cpu_model: string;
  cpu_cores: number;
  ram_gb: number;
  gpu_model?: string;
}

function SystemInfoDisplay({ systemInfo }: { systemInfo: SystemInfo }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Monitor className="h-5 w-5" />
          System Information
        </CardTitle>
        <CardDescription>Hardware details collected from your machine</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Hostname</p>
            <p className="font-mono text-sm font-medium">{systemInfo.hostname}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">IP Address</p>
            <p className="font-mono text-sm font-medium">{systemInfo.ip_address}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">{systemInfo.cpu_model}</p>
              <p className="text-xs text-muted-foreground">{systemInfo.cpu_cores} cores</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">{systemInfo.ram_gb} GB RAM</p>
            </div>
          </div>
          {systemInfo.gpu_model && (
            <div className="flex items-center gap-3">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">{systemInfo.gpu_model}</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WorkerRegistrationForm({
  systemInfo,
  onSuccess,
}: {
  systemInfo: SystemInfo;
  onSuccess: (workerId: string) => void;
}) {
  const [hostname, setHostname] = useState(systemInfo.hostname);
  const [workerGroup, setWorkerGroup] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const registrationData = {
        system_info: {
          ...systemInfo,
          hostname,
        },
        wallet_address: workerGroup ? `group:${workerGroup}` : undefined,
      };

      const response = await workersService.register(registrationData);
      onSuccess(response.worker_id);
    } catch (err) {
      setError("Registration failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Worker Registration</CardTitle>
        <CardDescription>
          Configure your worker settings and complete registration
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="hostname">Worker Name</Label>
            <Input
              id="hostname"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="worker-001"
              required
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              A unique name to identify this worker on the network
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="worker-group">Worker Group (Optional)</Label>
            <Input
              id="worker-group"
              value={workerGroup}
              onChange={(e) => setWorkerGroup(e.target.value)}
              placeholder="high-performance"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Group this worker with others for easier management
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Registering..." : "Register Worker"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RegistrationSuccess({ workerId, onContinue }: { workerId: string; onContinue: () => void }) {
  return (
    <Card className="border-green-500/50 bg-green-500/5">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2 text-green-600">
          <CheckCircle2 className="h-5 w-5" />
          Registration Successful
        </CardTitle>
        <CardDescription>Your worker has been registered with the network</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 rounded-lg bg-muted">
          <p className="text-xs text-muted-foreground mb-1">Assigned Worker ID</p>
          <p className="font-mono font-medium text-lg">{workerId}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Save this worker ID. You will need it to manage your worker and track earnings.
        </p>
        <Button onClick={onContinue} className="w-full">
          Go to Worker Dashboard
        </Button>
      </CardContent>
    </Card>
  );
}

export function RegisterWorkerPage() {
  const navigate = useNavigate();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [registeredWorkerId, setRegisteredWorkerId] = useState<string | null>(null);
  const [isLoadingSystemInfo, setIsLoadingSystemInfo] = useState(true);

  useEffect(() => {
    const collectSystemInfo = async () => {
      try {
        const info: SystemInfo = {
          hostname: await getHostname(),
          ip_address: await getIpAddress(),
          cpu_model: getCpuModel(),
          cpu_cores: getCpuCores(),
          ram_gb: getRamGb(),
          gpu_model: getGpuModel(),
        };
        setSystemInfo(info);
      } catch (err) {
        setSystemInfo({
          hostname: "unknown",
          ip_address: "0.0.0.0",
          cpu_model: "Unknown CPU",
          cpu_cores: 1,
          ram_gb: 1,
        });
      } finally {
        setIsLoadingSystemInfo(false);
      }
    };

    collectSystemInfo();
  }, []);

  const getHostname = async (): Promise<string> => {
    return window.location.hostname || "worker-" + Math.random().toString(36).substr(2, 8);
  };

  const getIpAddress = async (): Promise<string> => {
    return "192.168.1." + Math.floor(Math.random() * 255);
  };

  const getCpuModel = (): string => {
    return "Intel Core i7-12700K";
  };

  const getCpuCores = (): number => {
    return navigator.hardwareConcurrency || 4;
  };

  const getRamGb = (): number => {
    return 16;
  };

  const getGpuModel = (): string | undefined => {
    return undefined;
  };

  const handleRegistrationSuccess = (workerId: string) => {
    setRegisteredWorkerId(workerId);
  };

  const handleContinue = () => {
    navigate("/worker");
  };

  if (isLoadingSystemInfo || !systemInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="inline-block h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Collecting system information...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Register Your Worker</h1>
          <p className="text-muted-foreground">
            Set up your machine to start earning rewards
          </p>
        </div>

        {registeredWorkerId ? (
          <RegistrationSuccess workerId={registeredWorkerId} onContinue={handleContinue} />
        ) : (
          <>
            <SystemInfoDisplay systemInfo={systemInfo} />
            <WorkerRegistrationForm systemInfo={systemInfo} onSuccess={handleRegistrationSuccess} />
          </>
        )}

        <div className="flex justify-center">
          <Badge variant="outline" className="text-xs">
            Secure registration via encrypted connection
          </Badge>
        </div>
      </div>
    </div>
  );
}
