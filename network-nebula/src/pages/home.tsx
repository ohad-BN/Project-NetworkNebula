import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Zap,
  Coins,
  Globe,
  ArrowRight,
  Sparkles,
  Cpu,
  Server,
  Users,
  Play,
} from "lucide-react";

export function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Split-Screen Hero Section */}
      <section className="grid grid-cols-1 md:grid-cols-2 min-h-[70vh]">
        {/* Left Side - Earner/Host Track */}
        <div className="bg-slate-900 text-white py-16 px-8 md:px-12 flex flex-col justify-center">
          <div className="max-w-lg mx-auto md:mx-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800 px-4 py-1.5 text-sm text-slate-300 mb-6">
              <Zap className="h-4 w-4" />
              <span>For PC Gamers & Hardware Owners</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
              Turn Your Idle GPU Into Passive Income
            </h1>
            <p className="text-lg text-slate-400 mb-8 leading-relaxed">
              Join the decentralized network. Get paid in tokens for every AI
              rendering job your PC completes while you sleep.
            </p>
            <Link to="/register/worker">
              <Button
                size="lg"
                variant="secondary"
                className="gap-2 bg-slate-100 text-slate-900 hover:bg-slate-200"
              >
                Become a Host <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <div className="mt-8 flex items-center gap-4 text-sm text-slate-500">
              <div className="flex items-center gap-1">
                <Coins className="h-4 w-4" />
                <span>Earn $50-200/month</span>
              </div>
              <div className="flex items-center gap-1">
                <Cpu className="h-4 w-4" />
                <span>Low resource usage</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Creator/Renter Track */}
        <div className="bg-gradient-to-br from-primary/5 to-background py-16 px-8 md:px-12 flex flex-col justify-center border-l border-border">
          <div className="max-w-lg mx-auto md:mx-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm text-primary mb-6">
              <Sparkles className="h-4 w-4" />
              <span>For AI Startups & Creators</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-6">
              The Decentralized Visual AI Network
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
              Rent massive GPU power for a fraction of cloud costs. Drop-in API
              integration for your AI startup.
            </p>
            <Link to="/register">
              <Button size="lg" className="gap-2">
                Rent GPUs <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <div className="mt-8 flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Zap className="h-4 w-4" />
                <span>10x cheaper than AWS</span>
              </div>
              <div className="flex items-center gap-1">
                <Globe className="h-4 w-4" />
                <span>Global GPU network</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works - Flow Diagram Section */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground">
              The complete orchestration pipeline
            </p>
          </div>

          {/* Horizontal Flow Diagram */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 md:gap-4">
            {/* Step 1: Creators Submit */}
            <div className="flex-1 text-center">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <Play className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Creators Submit Tasks
              </h3>
              <p className="text-sm text-muted-foreground">
                Upload images or prompts via REST API
              </p>
            </div>

            {/* Arrow */}
            <div className="hidden md:flex items-center">
              <svg
                className="w-16 h-8 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </div>

            {/* Step 2: Nebula Orchestrator */}
            <div className="flex-1 text-center">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                <Server className="h-8 w-8 text-indigo-500" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Nebula Orchestrator
              </h3>
              <p className="text-sm text-muted-foreground">
                Queues tasks & routes to available workers
              </p>
            </div>

            {/* Arrow */}
            <div className="hidden md:flex items-center">
              <svg
                className="w-16 h-8 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </div>

            {/* Step 3: Distributed PCs Render */}
            <div className="flex-1 text-center">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-green-500" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Distributed PCs Render
              </h3>
              <p className="text-sm text-muted-foreground">
                Gamer PCs process jobs in parallel
              </p>
            </div>
          </div>

          {/* Visual Connector Line (mobile) */}
          <div className="md:hidden flex justify-center py-4">
            <svg
              className="w-8 h-16 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7H3"
              />
            </svg>
          </div>
        </div>
      </section>

      {/* Feature Highlights */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-7xl">
          <h2 className="text-3xl font-bold text-center mb-12">
            Why Choose Network Nebula
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <Zap className="h-10 w-10 text-primary mb-4" />
                <CardTitle>Fast Generation</CardTitle>
                <CardDescription>
                  Leverage distributed GPU power for rapid image generation
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Coins className="h-10 w-10 text-primary mb-4" />
                <CardTitle>Low Cost</CardTitle>
                <CardDescription>
                  Pay only for what you use with our competitive pricing model
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Globe className="h-10 w-10 text-primary mb-4" />
                <CardTitle>Decentralized</CardTitle>
                <CardDescription>
                  No single point of failure, powered by a global network
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Pricing Preview */}
      <section className="py-16 px-4 bg-muted/50">
        <div className="container mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-muted-foreground">
              Pay only for the compute you use
            </p>
          </div>
          <div className="max-w-md mx-auto">
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="text-center">
                <CardTitle className="text-4xl font-bold">$0.001</CardTitle>
                <CardDescription>per megapixel-step</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-sm text-muted-foreground">
                  For a 512x512 image at 20 steps, that's only{" "}
                  <span className="font-semibold text-foreground">$0.01</span>{" "}
                  per image!
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
