import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Zap, Loader2, X, ImageIcon, Sparkles, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { taskService } from "@/services/api/tasks";
import { useAuth } from "@/hooks/use-auth";

const RATE_PER_MEGAPIXEL_STEP = 0.001;

const EXAMPLE_PROMPTS = [
  "A serene mountain landscape at sunset with golden light",
  "Futuristic city with flying cars and neon lights",
  "A cozy coffee shop interior with warm lighting",
  "Abstract art composition with vibrant colors",
];

const IMAGE_PRESETS = [
  { label: "Square (512x512)", width: 512, height: 512 },
  { label: "Portrait (512x768)", width: 512, height: 768 },
  { label: "Landscape (768x512)", width: 768, height: 512 },
  { label: "Wide (1024x512)", width: 1024, height: 512 },
];

interface ImageSettings {
  width: number;
  height: number;
  steps: number;
}

export function CreateJobPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<ImageSettings>({
    width: 512,
    height: 512,
    steps: 20,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charCount = prompt.length;
  const maxChars = 500;
  const megapixels = (settings.width * settings.height) / 1000000;
  const estimatedCost = RATE_PER_MEGAPIXEL_STEP * megapixels * settings.steps;

  useEffect(() => {
    if (!isAuthenticated) {
      toast.error("Please login to create jobs");
      navigate("/login");
    }
  }, [isAuthenticated, navigate]);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= maxChars) {
      setPrompt(value);
      setError(null);
    }
  };

  const handleClearPrompt = () => {
    setPrompt("");
    setError(null);
  };

  const handleExampleClick = (example: string) => {
    if (prompt.length + example.length <= maxChars) {
      setPrompt(prompt + (prompt ? " " : "") + example);
    } else {
      setPrompt(example);
    }
  };

  const handlePresetSelect = (preset: { width: number; height: number }) => {
    setSettings((prev) => ({ ...prev, width: preset.width, height: preset.height }));
  };

  const handleSettingChange = (field: keyof ImageSettings, value: number) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const validateForm = (): boolean => {
    if (!prompt.trim()) {
      setError("Please enter a prompt");
      return false;
    }
    if (settings.width < 256 || settings.width > 1024) {
      setError("Width must be between 256 and 1024");
      return false;
    }
    if (settings.height < 256 || settings.height > 1024) {
      setError("Height must be between 256 and 1024");
      return false;
    }
    if (settings.steps < 10 || settings.steps > 50) {
      setError("Steps must be between 10 and 50");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const task = await taskService.submit({
        prompt: prompt.trim(),
        width: settings.width,
        height: settings.height,
        num_images: 1,
      });

      toast.success("Job submitted successfully!");
      navigate("/job-status/" + task.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit job";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="container mx-auto max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create Image Generation Job</h1>
          <p className="text-muted-foreground">Describe your image and configure settings</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Prompt Input */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Prompt
              </CardTitle>
              <CardDescription>Describe the image you want to generate</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Textarea
                  value={prompt}
                  onChange={handlePromptChange}
                  placeholder="A beautiful landscape with mountains and a lake at sunset..."
                  className="min-h-32 resize-none pr-16"
                  disabled={isSubmitting}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={handleClearPrompt}
                  disabled={!prompt || isSubmitting}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Character count</span>
                <span className={charCount > maxChars * 0.9 ? "text-warning" : "text-muted-foreground"}>
                  {charCount} / {maxChars}
                </span>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">Example prompts</Label>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_PROMPTS.map((example, index) => (
                    <Button
                      key={index}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleExampleClick(example)}
                      disabled={isSubmitting}
                      className="text-xs h-7"
                    >
                      {example.slice(0, 30)}...
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Image Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                Image Settings
              </CardTitle>
              <CardDescription>Configure dimensions and generation steps</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">Presets</Label>
                <div className="flex flex-wrap gap-2">
                  {IMAGE_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant={settings.width === preset.width && settings.height === preset.height ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePresetSelect(preset)}
                      disabled={isSubmitting}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="width">Width (px)</Label>
                  <Input
                    id="width"
                    type="number"
                    min={256}
                    max={1024}
                    step={64}
                    value={settings.width}
                    onChange={(e) => handleSettingChange("width", parseInt(e.target.value) || 256)}
                    disabled={isSubmitting}
                  />
                  <span className="text-xs text-muted-foreground">256-1024</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="height">Height (px)</Label>
                  <Input
                    id="height"
                    type="number"
                    min={256}
                    max={1024}
                    step={64}
                    value={settings.height}
                    onChange={(e) => handleSettingChange("height", parseInt(e.target.value) || 256)}
                    disabled={isSubmitting}
                  />
                  <span className="text-xs text-muted-foreground">256-1024</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="steps">Generation Steps</Label>
                <Input
                  id="steps"
                  type="number"
                  min={10}
                  max={50}
                  value={settings.steps}
                  onChange={(e) => handleSettingChange("steps", parseInt(e.target.value) || 20)}
                  disabled={isSubmitting}
                />
                <span className="text-xs text-muted-foreground">Higher steps = more detail (10-50)</span>
              </div>
            </CardContent>
          </Card>

          {/* Cost Estimate */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Cost Estimate
              </CardTitle>
              <CardDescription>Estimated cost for this generation</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Resolution</span>
                  <span>{settings.width} x {settings.height}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Megapixels</span>
                  <span>{megapixels.toFixed(2)} MP</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Steps</span>
                  <span>{settings.steps}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Rate</span>
                  <span>${RATE_PER_MEGAPIXEL_STEP}/MP-step</span>
                </div>
                <div className="border-t pt-3 flex justify-between font-semibold">
                  <span>Estimated Cost</span>
                  <span className="text-primary">${estimatedCost.toFixed(4)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Submit Button */}
          <div className="flex justify-between items-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/")}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !prompt.trim()}
              className="gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Submit Job
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
