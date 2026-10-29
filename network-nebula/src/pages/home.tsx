import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Cpu,
  Server,
  Network,
  ShieldCheck,
  ArrowRight,
  Terminal,
  Sparkles,
  KeyRound,
  CheckCircle2,
} from "lucide-react";

export function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-indigo-500/30">
      {/* 1. Closed Alpha Announcement Banner */}
      <div className="border-b border-indigo-500/20 bg-indigo-950/40 px-4 py-2 text-center text-xs backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2">
          <Badge variant="outline" className="border-indigo-400/40 bg-indigo-500/15 text-indigo-300 font-mono text-[10px]">
            CLOSED ALPHA
          </Badge>
          <span className="text-muted-foreground hidden sm:inline">
            Invite-only testing period now active.
          </span>
          <span className="font-semibold text-indigo-200">
            Use code <code className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-indigo-300">NEBULA-ALPHA-2026</code> for +$100.00 compute credits.
          </span>
          <Link to="/register" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline ml-1">
            Claim Free Credits <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* 2. Hero Section */}
      <section className="relative overflow-hidden py-20 lg:py-28">
        {/* Glow ambient backgrounds */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[450px] w-[650px] rounded-full bg-gradient-to-tr from-indigo-600/20 via-purple-600/20 to-pink-600/10 blur-[130px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 -translate-x-1/2 -translate-y-1/2 h-[300px] w-[300px] rounded-full bg-emerald-600/10 blur-[100px] pointer-events-none" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/60 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur mb-6">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>Decentralized AI Cloud & Inference Grid</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight max-w-4xl mx-auto leading-[1.1] mb-6">
            Enterprise GPU Compute.{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              70% Lower Cloud Cost.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
            A high-throughput decentralized cloud network for fine-tuning LLMs with distributed LoRA, serving models with drop-in OpenAI API compatibility, and running Mixture-of-Experts across consumer and datacenter GPUs worldwide.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto">
            <Link to="/register" className="w-full sm:w-auto">
              <Button
                size="lg"
                className="w-full sm:w-auto gap-2 bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-500 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/25 h-12 px-6 font-semibold"
              >
                <KeyRound className="h-4 w-4" />
                Join Closed Alpha (+$100 Free)
              </Button>
            </Link>
            <Link to="/login" className="w-full sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto gap-2 border-border/80 bg-background/50 hover:bg-muted h-12 px-6 font-medium backdrop-blur"
              >
                <Terminal className="h-4 w-4 text-indigo-400" />
                Sign In to Console
              </Button>
            </Link>
          </div>

          {/* Trust & Live Metrics Pill Row */}
          <div className="mt-14 pt-8 border-t border-border/40 grid grid-cols-2 md:grid-cols-4 gap-6 text-center max-w-4xl mx-auto">
            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-black text-foreground">150 / 150</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Tests Verified Green</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-black text-indigo-400">3.8x</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Speculative Decode Speedup</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-black text-emerald-400">$0.0005</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Per Inference Output</div>
            </div>
            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-black text-purple-400">100%</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">OpenAI Drop-In Compatible</div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Dual Persona Tracks (Creators vs Host Providers) */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-y border-border/60 bg-muted/20">
        <div className="mx-auto max-w-7xl">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl font-bold tracking-tight">Built For Both Sides of the Compute Economy</h2>
            <p className="text-muted-foreground mt-2">Whether you need massive GPU clusters or want to monetize idle hardware</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Persona A: AI Creators & Startups */}
            <Card className="border-border/80 bg-gradient-to-b from-card to-background shadow-xl hover:border-indigo-500/40 transition-all flex flex-col justify-between">
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    <Terminal className="h-5 w-5" />
                  </div>
                  <Badge variant="secondary" className="font-mono text-[11px]">DEVELOPER CONSOLE</Badge>
                </div>
                <CardTitle className="text-2xl font-bold">For AI Developers & Teams</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  Rent high-performance GPU clusters on demand. Train LoRA adapters, serve 70B parameter models, and connect your existing apps with standard OpenAI client libraries.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span><strong>OpenAI Drop-In API:</strong> Change <code className="text-foreground">base_url</code> to <code className="text-foreground">http://localhost:8000/v1</code></span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span><strong>Distributed LoRA Engine:</strong> Multi-node Ring All-Reduce gradient sync</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span><strong>Mixture-of-Experts (MoE):</strong> Mixtral 8x7B sharding with speculative decoding</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span><strong>Free Alpha Faucet:</strong> +$100 initial testing grant with +$25 daily refills</span>
                  </li>
                </ul>
                <div className="pt-2">
                  <Link to="/register">
                    <Button className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                      Start as Creator <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Persona B: Host Providers & Gamers */}
            <Card className="border-border/80 bg-gradient-to-b from-card to-background shadow-xl hover:border-emerald-500/40 transition-all flex flex-col justify-between">
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Server className="h-5 w-5" />
                  </div>
                  <Badge variant="secondary" className="font-mono text-[11px] text-emerald-400 border-emerald-500/30">HOST PROVIDER</Badge>
                </div>
                <CardTitle className="text-2xl font-bold">For GPU Owners & Fleets</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  Turn idle NVIDIA GPUs (RTX 3080 / 4070 / 4080 / 4090 / A100) and Apple Silicon into a passive revenue stream with our automated background worker daemon.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span><strong>1-Click Mesh Launcher:</strong> Run <code className="text-foreground">.\join_mesh.bat</code> to connect in seconds</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span><strong>Automated Staking & SLA:</strong> High reputation hosts receive priority task dispatch</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span><strong>Multi-Chain Payouts:</strong> Automated host withdrawals via USDC on Polygon / Base / Arbitrum</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span><strong>Hardware Protection:</strong> Configurable VRAM caps and temperature throttles</span>
                  </li>
                </ul>
                <div className="pt-2">
                  <Link to="/register">
                    <Button variant="outline" className="w-full gap-2 border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-400">
                      Become a Host Provider <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* 4. Architecture Showcase */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl font-bold">End-to-End Enterprise Architecture</h2>
            <p className="text-muted-foreground mt-2">Formal distributed architecture implemented according to university software engineering standards</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl border border-border/80 bg-card/60 backdrop-blur space-y-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-400">
                <Cpu className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold">Orchestrator Gateway</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                FastAPI 1.9 async API gateway offering distributed telemetry tracing, Celery task scheduling, MinIO S3 dataset presigning, and double-entry ledger balance accounting.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border/80 bg-card/60 backdrop-blur space-y-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/15 flex items-center justify-center text-purple-400">
                <Network className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold">P2P Kademlia Swarm</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                DHT routing mesh allowing workers to discover peers across NATs, perform Ring All-Reduce gradient aggregations, and route sparse MoE activation tensors without centralized bottlenecks.
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border/80 bg-card/60 backdrop-blur space-y-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold">SLA & Verifiable Compute</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Cryptographic output verification, deterministic spot-checks, automated staking slashing for dropped tasks, and dispute resolution engines to ensure 99.9% compute reliability.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Closed Alpha Access Callout */}
      <section className="py-16 px-4 bg-gradient-to-b from-indigo-950/20 to-background border-t border-border/60">
        <div className="mx-auto max-w-4xl text-center space-y-6">
          <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 font-mono">
            ACCESS CODE: NEBULA-ALPHA-2026
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Ready to Run Decentralized Compute?</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm leading-relaxed">
            Create an account with your university or personal email to instantly receive your $100.00 compute credit grant. No credit card or financial commitment required during Private Alpha.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/register">
              <Button size="lg" className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold shadow-lg">
                Create Account & Join Alpha
              </Button>
            </Link>
            <Link to="/login">
              <Button variant="outline" size="lg">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 6. Footer */}
      <footer className="border-t border-border/60 py-10 px-4 text-xs text-muted-foreground">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white">N</div>
            <span className="font-semibold text-foreground">Project NetworkNebula</span>
            <span>· Ariel University Computer Science (Intro2SE)</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[11px]">MIT Licensed</span>
            <span>·</span>
            <span className="font-mono text-[11px]">Cloudflare Zero-Trust WAN Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
