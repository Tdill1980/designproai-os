import { useState, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Vehicle360LoadingStateProps {
  totalAngles?: number;
  currentAngle?: number;
  currentAngleLabel?: string;
  generatedPreviews?: {angle: number, url: string, label: string}[];
  onCancel?: () => void;
  estimatedTimePerAngle?: number; // in seconds
}

export function Vehicle360LoadingState({
  totalAngles = 12,
  currentAngle = 0,
  currentAngleLabel,
  generatedPreviews = [],
  onCancel,
  estimatedTimePerAngle = 3
}: Vehicle360LoadingStateProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  
  const progress = (currentAngle / totalAngles) * 100;
  const anglesRemaining = totalAngles - currentAngle;
  const estimatedTimeRemaining = anglesRemaining * estimatedTimePerAngle;

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <Card className="p-6 bg-card border-border">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Generating 360° Spin View
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Currently rendering: <span className="text-primary font-medium">{currentAngleLabel || `${currentAngle * 30}°`}</span>
            </p>
          </div>
          {onCancel && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground font-medium">
              {currentAngle} of {totalAngles} angles completed
            </span>
            <span className="text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
        </div>

        {/* Time Estimates */}
        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Time Elapsed</p>
            <p className="text-sm font-medium text-foreground">
              {formatTime(elapsedTime)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Est. Remaining</p>
            <p className="text-sm font-medium text-foreground">
              {formatTime(estimatedTimeRemaining)}
            </p>
          </div>
        </div>

        {/* Angle Grid Indicator */}
        <div className="pt-2">
          <p className="text-xs text-muted-foreground mb-2">Angle Progress</p>
          <div className="grid grid-cols-12 gap-1">
            {Array.from({ length: totalAngles }).map((_, idx) => (
              <div
                key={idx}
                className={`h-2 rounded-sm transition-colors ${
                  idx < currentAngle
                    ? 'bg-primary'
                    : idx === currentAngle
                    ? 'bg-primary/50 animate-pulse'
                    : 'bg-muted'
                }`}
                title={`${idx * 30}°`}
              />
            ))}
          </div>
        </div>

        {/* Preview Thumbnails */}
        {generatedPreviews.length > 0 && (
          <div className="pt-3">
            <p className="text-xs text-muted-foreground mb-2">Completed Views ({generatedPreviews.length}/{totalAngles})</p>
            <div className="grid grid-cols-6 gap-2">
              {generatedPreviews.map((preview) => (
                <div key={preview.angle} className="relative aspect-video rounded overflow-hidden border border-border">
                  <img 
                    src={preview.url} 
                    alt={preview.label}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/80 text-[8px] text-white text-center py-0.5 px-1 truncate">
                    {preview.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Message */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            💡 Tip: Each angle is generated with photorealistic AI rendering. 
            Once complete, you'll be able to drag and rotate your vehicle in full 360°.
          </p>
        </div>
      </div>
    </Card>
  );
}
