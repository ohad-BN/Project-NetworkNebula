import { useEffect, useState } from "react";
import {
  Key,
  Plus,
  Copy,
  Check,
  ShieldCheck,
  Trash2,
  RotateCw,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiClient } from "@/services/api/client";
import { toast } from "sonner";

interface ApiTokenItem {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string;
  rate_limit_rpm: number;
  is_active: boolean;
  created_at: string;
  last_used_at?: string;
}

export function ApiTokensPage() {
  const [tokens, setTokens] = useState<ApiTokenItem[]>([]);
  const [_isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Form State
  const [tokenName, setTokenName] = useState("");
  const [scopes, setScopes] = useState("training,inference");
  const [rateLimit, setRateLimit] = useState("120");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Newly Created Token Banner
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const fetchTokens = async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get<ApiTokenItem[]>("/api/v1/tokens");
      setTokens(res.data);
    } catch (err: any) {
      toast.error("Failed to fetch API tokens");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, []);

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName.trim()) {
      toast.error("Token name is required");
      return;
    }
    try {
      setIsSubmitting(true);
      const res = await apiClient.post("/api/v1/tokens", {
        name: tokenName.trim(),
        scopes: scopes,
        rate_limit_rpm: parseInt(rateLimit, 10) || 120,
      });
      setCreatedSecret(res.data.token);
      toast.success("Scoped Bearer API token generated");
      setIsCreateOpen(false);
      setTokenName("");
      fetchTokens();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to create token");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeToken = async (tokenId: string, name: string) => {
    try {
      await apiClient.delete(`/api/v1/tokens/${tokenId}`);
      toast.info(`Token '${name}' revoked`);
      fetchTokens();
    } catch (err: any) {
      toast.error("Failed to revoke token");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSecret(true);
    toast.success("Token copied to clipboard");
    setTimeout(() => setCopiedSecret(false), 2500);
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Key className="h-8 w-8 text-primary" />
            API Tokens & Security
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage scoped Bearer tokens to authenticate CI/CD pipelines, Python SDKs, and OpenAI gateways
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchTokens} className="gap-2">
            <RotateCw className="h-4 w-4" />
            Refresh
          </Button>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Generate New Token
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Generate Scoped Bearer Token</DialogTitle>
                <DialogDescription>
                  This token grants programmatic access to fine-tuning and inference endpoints.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateToken} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="tokenName">Token Description</Label>
                  <Input
                    id="tokenName"
                    placeholder="e.g. Production Backend Service"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scopesSelect">Permission Scopes</Label>
                  <select
                    id="scopesSelect"
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-1 focus-visible:ring-ring"
                    value={scopes}
                    onChange={(e) => setScopes(e.target.value)}
                  >
                    <option value="training,inference">Full Access (training, inference)</option>
                    <option value="inference">Inference Only (/v1/chat/completions)</option>
                    <option value="training">Training Only (/api/v1/training/*)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rpm">Rate Limit (Requests / Minute)</Label>
                  <Input
                    id="rpm"
                    type="number"
                    min="10"
                    max="10000"
                    value={rateLimit}
                    onChange={(e) => setRateLimit(e.target.value)}
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Generating..." : "Generate Key"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Secret Token Flash Banner */}
      {createdSecret && (
        <div className="mb-8 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 dark:text-emerald-200">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                Token Created Successfully
              </div>
              <p className="text-xs text-muted-foreground">
                Copy this token now. For security purposes, this secret will not be displayed again.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <code className="px-3 py-1.5 rounded bg-muted font-mono text-xs text-foreground select-all">
                  {createdSecret}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => copyToClipboard(createdSecret)}
                >
                  {copiedSecret ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  Copy
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setCreatedSecret(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Active Tokens Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Provisioned API Keys ({tokens.length})
          </CardTitle>
          <CardDescription>
            Pass as <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">Authorization: Bearer nebula_sk_...</code> in your HTTP requests
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No active API keys found. Generate a key to begin making SDK requests.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b">
                  <tr>
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Prefix</th>
                    <th className="py-3 px-4">Scopes</th>
                    <th className="py-3 px-4">Rate Limit</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tokens.map((token) => (
                    <tr key={token.id} className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-semibold">{token.name}</td>
                      <td className="py-3 px-4 font-mono text-xs">{token.token_prefix}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="text-xs">{token.scopes}</Badge>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">{token.rate_limit_rpm} rpm</td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {new Date(token.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        {token.is_active ? (
                          <Badge variant="default" className="bg-emerald-600 text-xs">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-xs">Revoked</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {token.is_active && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => handleRevokeToken(token.id, token.name)}
                          >
                            <Trash2 className="h-4 w-4" />
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
    </div>
  );
}
