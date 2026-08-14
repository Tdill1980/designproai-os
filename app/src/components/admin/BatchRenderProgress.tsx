import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Check, Lightbulb, Clock, Zap, Heart,
  ShieldCheck, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RenderJob } from "@/lib/bulk-prompt-generator";
import { formatVehicleName } from "@/lib/vehicle-selection";

interface BatchRenderProgressProps {
  jobs: RenderJob[];
  running: boolean;
  currentIdx: number;
  healingActive: boolean;
  done: number;
  failed: number;
  healed: number;
  avgTime: number;
}

const BATCH_TIPS = [
  "Pro Tip: Each design is generated with a unique AI prompt + finish combo",
  "Did you know? Self-healing auto-retries failed renders with enhanced prompts",
  "Pro Tip: Rate designs to train the NeuralNetwork quality model",
  "Fun Fact: 6-view generation captures every angle of the vehicle",
  "Pro Tip: Production packs generate print-ready files at 186\" x 56\"",
  "Did you know? VisionBoardIQ passes reference images to every render",
  "Pro Tip: Low-rating pattern detection identifies systematic quality issues",
  "Fun Fact: Our AI engine generates photorealistic wraps in ~45s",
];

export function BatchRenderProgress({
  jobs,
  running,
  currentIdx,
  healingActive,
  done,
  failed,
  healed,
  avgTime,
}: BatchRenderProgressProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);

  const currentJob = jobs[currentIdx] || null;
  const totalJobs = jobs.length;
  const overallProgress = totalJobs > 0 ? ((done + failed) / totalJobs) * 100 : 0;

  // Timer for current job
  useEffect(() => {
    if (!running) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [running, currentIdx]);

  // Rotate tips
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % BATCH_TIPS.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [running]);

  // ETA calculation
  const remainingJobs = totalJobs - done - failed;
  const estimatedSecondsRemaining = avgTime > 0 ? remainingJobs * avgTime : remainingJobs * 45;
  const etaMinutes = Math.ceil(estimatedSecondsRemaining / 60);

  // Progress steps for current job
  const getSteps = () => {
    if (!currentJob) return [];
    const isRunning = currentJob.status === "running";
    const isDone = currentJob.status === "done";
    const isFailed = currentJob.status === "failed";
    const isHealing = currentJob.healStatus === "retrying";

    return [
      { label: "Queued", completed: isRunning || isDone || isFailed },
      { label: isHealing ? "Self-Healing..." : "Generating 3D Render", completed: isDone || (isFailed && !isHealing), active: isRunning },
      { label: "Quality Gate", completed: isDone },
      { label: isDone ? "Complete" : isFailed ? "Failed" : "Pending", completed: isDone },
    ];
  };

  if (!running && !healingActive) return null;

  return (
    <Card className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-blue-950/30 border-blue-500/20 mb-6 overflow-hidden">
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[9px] font-bold text-blue-300">
                  {currentIdx + 1}
                </span>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {healingActive ? "Self-Healing Sweep" : `Rendering ${currentIdx + 1} of ${totalJobs}`}
              </h3>
              {currentJob && (
                <p className="text-[11px] text-zinc-400">
                  {formatVehicleName(currentJob.vehicle)} &middot; {currentJob.finish}
                </p>
              )}
            </div>
          </div>

          {/* Live stats */}
          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1 text-blue-400">
              <Clock className="h-3.5 w-3.5" />
              <span className="font-mono font-bold">{elapsedSeconds}s</span>
            </div>
            {avgTime > 0 && (
              <span className="text-zinc-500">avg {avgTime}s</span>
            )}
            {etaMinutes > 0 && (
              <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">
                ~{etaMinutes}m remaining
              </Badge>
            )}
          </div>
        </div>

        {/* Overall progress bar */}
        <div className="mb-4">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-zinc-400">Batch Progress</span>
            <span className="text-zinc-500">{Math.round(overallProgress)}%</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-700"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>

        {/* Current job steps + stats row */}
        <div className="flex items-start gap-6">
          {/* Step indicators for current job */}
          <div className="flex items-center gap-2 flex-1">
            {getSteps().map((step, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center transition-all text-[10px]",
                    step.completed
                      ? "bg-blue-500 text-white"
                      : step.active
                        ? "bg-blue-500/20 border border-blue-500 text-blue-400"
                        : "bg-zinc-800 border border-zinc-700 text-zinc-600"
                  )}
                >
                  {step.completed ? (
                    <Check className="w-3 h-3" />
                  ) : step.active ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] whitespace-nowrap",
                    step.completed ? "text-blue-400" : step.active ? "text-white" : "text-zinc-600"
                  )}
                >
                  {step.label}
                </span>
                {idx < 3 && (
                  <div className={cn(
                    "w-4 h-px",
                    step.completed ? "bg-blue-500/50" : "bg-zinc-700"
                  )} />
                )}
              </div>
            ))}
          </div>

          {/* Live counters */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1 text-[11px]">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              <span className="text-green-400 font-bold">{done}</span>
            </div>
            {healed > 0 && (
              <div className="flex items-center gap-1 text-[11px]">
                <Heart className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-bold">{healed}</span>
              </div>
            )}
            {failed > 0 && (
              <div className="flex items-center gap-1 text-[11px]">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-red-400 font-bold">{failed}</span>
              </div>
            )}
          </div>
        </div>

        {/* Rotating tip */}
        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 bg-zinc-800/50 rounded-lg">
          <Lightbulb className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-zinc-400 italic">
            {BATCH_TIPS[tipIndex]}
          </p>
        </div>
      </div>
    </Card>
  );
}
