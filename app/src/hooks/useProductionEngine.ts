/**
 * useProductionEngine - React hook for the Print Production OS engine.
 *
 * Provides reactive state management around the production engine,
 * handling async file generation, progress tracking, and result management.
 */

import { useState, useCallback, useRef } from 'react';
import {
  productionEngine,
  type PrintJobSpec,
  type ProductionResult,
  type VehiclePanelSet,
  type RollLayout,
  type MediaSpec,
  MEDIA_PRESETS,
} from '@/lib/print-production';
import {
  generatePanelSet,
  autoSelectPanels,
  validateCoverage,
} from '@/lib/print-production/panel-geometry';
import { nestPanelsOnRoll, estimatePrintTime } from '@/lib/print-production/nesting-engine';
import type { PanelSelection } from '@/lib/panelizer-config';

export interface ProductionEngineState {
  /** Current job specification */
  jobSpec: PrintJobSpec | null;
  /** Panel set for the selected vehicle */
  panelSet: VehiclePanelSet | null;
  /** Roll layout (nesting result) */
  rollLayout: RollLayout | null;
  /** Validation result */
  validation: { accuracy: number; issues: string[] } | null;
  /** Production result (after running) */
  result: ProductionResult | null;
  /** Is the engine currently generating files */
  isGenerating: boolean;
  /** Current generation step */
  currentStep: string;
  /** Progress (0–100) */
  progress: number;
  /** Error message if any */
  error: string | null;
}

export function useProductionEngine() {
  const [state, setState] = useState<ProductionEngineState>({
    jobSpec: null,
    panelSet: null,
    rollLayout: null,
    validation: null,
    result: null,
    isGenerating: false,
    currentStep: '',
    progress: 0,
    error: null,
  });

  // Track blob URLs for cleanup
  const blobUrlsRef = useRef<string[]>([]);

  /**
   * Configure a job from vehicle + panel selection.
   * Does NOT generate files - just sets up the spec and preview.
   */
  const configureJob = useCallback((params: {
    make: string;
    model: string;
    year?: string;
    selection: PanelSelection;
    designImageUrl?: string;
    finish?: string;
    mediaPreset?: string;
    outputFormat?: 'pdf' | 'png';
    outputScale?: string;
    includeMarks?: boolean;
  }) => {
    const jobSpec = productionEngine.createJobSpec(params);

    if (!jobSpec) {
      setState(prev => ({
        ...prev,
        error: 'Vehicle not found in database',
        jobSpec: null,
        panelSet: null,
        rollLayout: null,
        validation: null,
      }));
      return;
    }

    // Get panel set
    const panelSet = jobSpec.vehiclePanels;

    // Run nesting
    const media = params.mediaPreset
      ? (MEDIA_PRESETS[params.mediaPreset] || undefined)
      : undefined;
    const rollLayout = nestPanelsOnRoll(panelSet, media);

    // Validate coverage
    const validation = validateCoverage(
      panelSet,
      params.make,
      params.model,
      params.year,
    );

    setState({
      jobSpec,
      panelSet,
      rollLayout,
      validation,
      result: null,
      isGenerating: false,
      currentStep: '',
      progress: 0,
      error: null,
    });
  }, []);

  /**
   * Run the full production job - generates all files.
   */
  const runProduction = useCallback(async () => {
    if (!state.jobSpec) {
      setState(prev => ({ ...prev, error: 'No job configured' }));
      return;
    }

    // Cleanup previous blob URLs
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];

    setState(prev => ({
      ...prev,
      isGenerating: true,
      currentStep: 'Initializing production engine...',
      progress: 0,
      error: null,
      result: null,
    }));

    try {
      setState(prev => ({
        ...prev,
        currentStep: 'Generating panel files...',
        progress: 20,
      }));

      const result = await productionEngine.runJob(state.jobSpec);

      // Track blob URLs for cleanup
      result.files.forEach(f => blobUrlsRef.current.push(f.blobUrl));
      if (result.rollLayoutFile) {
        blobUrlsRef.current.push(result.rollLayoutFile.blobUrl);
      }

      setState(prev => ({
        ...prev,
        result,
        isGenerating: false,
        currentStep: 'Complete',
        progress: 100,
      }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        isGenerating: false,
        currentStep: '',
        progress: 0,
        error: err instanceof Error ? err.message : 'Production failed',
      }));
    }
  }, [state.jobSpec]);

  /**
   * Download a production file.
   */
  const downloadFile = useCallback((file: { blobUrl: string; label: string; mimeType: string }) => {
    const ext = file.mimeType === 'application/pdf' ? 'pdf' : 'png';
    const filename = `${file.label.replace(/[^a-zA-Z0-9-_]/g, '_')}.${ext}`;

    const a = document.createElement('a');
    a.href = file.blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  /**
   * Download all files as individual downloads.
   */
  const downloadAll = useCallback(() => {
    if (!state.result) return;

    state.result.files.forEach((file, i) => {
      setTimeout(() => downloadFile(file), i * 500);
    });

    if (state.result.rollLayoutFile) {
      setTimeout(
        () => downloadFile(state.result!.rollLayoutFile!),
        state.result.files.length * 500,
      );
    }
  }, [state.result, downloadFile]);

  /**
   * Get auto-selected panels for a vehicle.
   */
  const getAutoSelection = useCallback((make: string, model: string, year?: string) => {
    return autoSelectPanels(make, model, year);
  }, []);

  /**
   * Preflight a color for print readiness.
   */
  const preflightColor = useCallback((hex: string) => {
    return productionEngine.preflightColor(hex);
  }, []);

  /**
   * Reset the engine state.
   */
  const reset = useCallback(() => {
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
    setState({
      jobSpec: null,
      panelSet: null,
      rollLayout: null,
      validation: null,
      result: null,
      isGenerating: false,
      currentStep: '',
      progress: 0,
      error: null,
    });
  }, []);

  return {
    ...state,
    configureJob,
    runProduction,
    downloadFile,
    downloadAll,
    getAutoSelection,
    preflightColor,
    reset,
  };
}
